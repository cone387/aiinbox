import { Platform, UnifiedConversation } from '../types'
import { PlatformAdapter, CapturedResponse, ParseResult } from './base'

export class ChatGPTAdapter extends PlatformAdapter {
  platform: Platform = 'chatgpt'
  urlPatterns = [
    'https://chat.openai.com/backend-api/conversation',
    'https://chatgpt.com/backend-api/conversation',
    'https://chat.openai.com/backend-api/conversation/',
    'https://chatgpt.com/backend-api/conversation/',
  ]

  matchRequest(url: string): boolean {
    return this.urlPatterns.some((pattern) => url.includes(pattern))
  }

  parseResponse(response: CapturedResponse): ParseResult {
    try {
      const body = response.body.trim()
      if (!body) {
        return { success: false, error: 'Empty response body' }
      }

      if (response.captureMode === 'history' || body.startsWith('{')) {
        return this.parseJSONResponse(body)
      }

      if (body.includes('data: ')) {
        return this.parseSSEResponse(body, response.isComplete)
      }

      return { success: false, error: 'Unrecognized ChatGPT response format' }
    } catch (err) {
      return { success: false, error: 'ChatGPT parse error: ' + String(err) }
    }
  }

  private parseSSEResponse(body: string, isComplete: boolean): ParseResult {
    const lines = body.split('\n').filter((l) => l.startsWith('data: '))
    const messages: Array<{ role: string; content: string; timestamp?: string }> = []
    let conversationId = ''
    let title = ''

    for (const line of lines) {
      const data = line.slice(6)
      if (data === '[DONE]') break

      try {
        const parsed = JSON.parse(data)

        // Skip version identifier and token messages
        if (typeof parsed === 'string' || parsed.type === 'resume_conversation_token') {
          continue
        }

        if (parsed.conversation_id) {
          conversationId = parsed.conversation_id
        }
        if (parsed.title) {
          title = parsed.title
        }

        // ===== CRDT operations: add/append/patch =====
        if (parsed.o !== undefined && parsed.v !== undefined) {
          if (parsed.o === 'add' && parsed.v?.message?.content?.parts) {
            this.handleAddMessage(parsed.v.message, messages)
          }
          if (parsed.o === 'append' && typeof parsed.v === 'string') {
            this.appendToLastMessage(messages, parsed.v)
          }
          if (parsed.o === 'patch' && Array.isArray(parsed.v)) {
            for (const op of parsed.v) {
              if (op.o === 'append' && typeof op.v === 'string') {
                this.appendToLastMessage(messages, op.v)
              }
            }
          }
          continue
        }

        // ===== Version Checkpoint entries: {v: {message: {...}}, c: N} =====
        if (parsed.v?.message && typeof parsed.c === 'number') {
          this.handleVersionCheckpoint(parsed.v.message, messages)
          continue
        }

        // ===== Bare value delta: {"v": "text"} — implicit append =====
        if (parsed.v !== undefined && parsed.o === undefined && parsed.c === undefined) {
          if (typeof parsed.v === 'string') {
            this.appendToLastMessage(messages, parsed.v)
            continue
          }
          // Bare array: {"v": [{...ops...}]} — batch of CRDT operations
          if (Array.isArray(parsed.v)) {
            for (const op of parsed.v) {
              if (op.o === 'append' && typeof op.v === 'string') {
                this.appendToLastMessage(messages, op.v)
              }
            }
            continue
          }
        }

        // ===== title_generation events =====
        if (parsed.type === 'title_generation' && parsed.title) {
          title = parsed.title
          continue
        }

        // Skip legacy input_message/output_message for user/assistant roles
        // (already handled by Version Checkpoint entries above)
        if (parsed.type === 'input_message' || parsed.type === 'output_message') {
          continue
        }
      } catch {
        // Skip unparseable lines
      }
    }

    // Deduplicate: remove system messages and empty entries
    const dedupedMessages = this.deduplicateMessages(messages)

    if (dedupedMessages.length === 0) {
      return { success: false, error: 'No messages found in SSE response' }
    }

    const conversation: UnifiedConversation = {
      id: this.generateId(),
      platform: this.platform,
      conversationId: conversationId || this.generateId(),
      title: title || '',
      messages: dedupedMessages.map((m) =>
        this.createMessage(this.mapRole(m.role), m.content, m.timestamp, isComplete)
      ),
      createdAt: dedupedMessages[0]?.timestamp || this.nowISO(),
      updatedAt: dedupedMessages[dedupedMessages.length - 1]?.timestamp || this.nowISO(),
    }

    return { success: true, conversation }
  }

  private parseJSONResponse(body: string): ParseResult {
    try {
      const data = JSON.parse(body)
      if (!data.mapping && !data.messages) {
        return { success: false, error: 'Not a conversation JSON response' }
      }

      const conversationId = data.conversation_id || data.id || ''
      const title = data.title || ''
      const messages: Array<{ role: string; content: string; timestamp?: string }> = []

      // ChatGPT uses a "mapping" object with message nodes
      if (data.mapping) {
        for (const node of Object.values(data.mapping) as any[]) {
          if (node?.message?.content?.parts?.length > 0) {
            const role = node.message.author?.role || 'unknown'
            if (role === 'system') continue
            const content = node.message.content.parts.join('')
            if (content) {
              messages.push({
                role,
                content,
                timestamp: node.message.create_time
                  ? new Date(node.message.create_time * 1000).toISOString()
                  : undefined,
              })
            }
          }
        }
      }

      messages.sort((a, b) => {
        const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0
        const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0
        return ta - tb
      })

      if (messages.length === 0) {
        return { success: false, error: 'No messages in JSON response' }
      }

      const conversation: UnifiedConversation = {
        id: this.generateId(),
        platform: this.platform,
        conversationId: conversationId || this.generateId(),
        title: title || messages[0]?.content.slice(0, 50) || 'Untitled',
        messages: messages.map((m) =>
          this.createMessage(this.mapRole(m.role), m.content, m.timestamp, true)
        ),
        createdAt: messages[0]?.timestamp || this.nowISO(),
        updatedAt: messages[messages.length - 1]?.timestamp || this.nowISO(),
      }

      return { success: true, conversation }
    } catch {
      return { success: false, error: 'Failed to parse JSON response' }
    }
  }

  private deduplicateMessages(messages: Array<{ role: string; content: string; timestamp?: string }>) {
    // Remove system messages, tool messages, and empty entries
    const filtered = messages.filter((m) =>
      m.role !== 'system' && m.role !== 'tool' && m.content.length > 0
    )
    // Merge consecutive same-role messages (keep last occurrence)
    const deduped: typeof filtered = []
    for (const msg of filtered) {
      const prev = deduped[deduped.length - 1]
      if (prev?.role === msg.role) {
        // Merge content: keep the one with more content (usually the later one)
        if (msg.content.length >= prev.content.length) {
          deduped[deduped.length - 1] = msg
        }
      } else {
        deduped.push(msg)
      }
    }
    return deduped
  }

  /**
   * Handle CRDT 'add' operation: creates a new message entry.
   */
  private handleAddMessage(
    msg: any,
    messages: Array<{ role: string; content: string; timestamp?: string }>
  ): void {
    const role = msg.author?.role || 'assistant'
    const content = msg.content?.parts?.join('') || ''
    if (content || role !== 'system') {
      messages.push({
        role,
        content,
        timestamp: msg.create_time
          ? new Date(msg.create_time * 1000).toISOString()
          : undefined,
      })
    }
  }

  /**
   * Handle version checkpoint entries: {v: {message: {...}}, c: N}
   * These carry the actual message content (user & assistant) in ChatGPT's v2 SSE format.
   */
  private handleVersionCheckpoint(
    msg: any,
    messages: Array<{ role: string; content: string; timestamp?: string }>
  ): void {
    const role = msg.author?.role
    if (!role || role === 'system') return

    const ct = msg.content?.content_type
    const parts = msg.content?.parts

    if (ct === 'model_editable_context') {
      // Placeholder for assistant's editable context — create a marker entry
      // so subsequent append operations have a target.
      // Only push if no same-role empty entry already exists
      const last = messages[messages.length - 1]
      if (!last || last.role !== role || last.content !== '') {
        messages.push({ role, content: '', timestamp: undefined })
      }
    } else if (ct === 'text' && Array.isArray(parts)) {
      const content = parts.join('')
      // If last message is same role + empty/placeholder, update it instead of creating new
      const last = messages[messages.length - 1]
      if (last?.role === role && last.content === '') {
        // Update the placeholder with actual text content
        messages[messages.length - 1] = {
          role,
          content,
          timestamp: msg.create_time
            ? new Date(msg.create_time * 1000).toISOString()
            : last.timestamp,
        }
      } else if (content || role === 'user') {
        messages.push({
          role,
          content,
          timestamp: msg.create_time
            ? new Date(msg.create_time * 1000).toISOString()
            : undefined,
        })
      }
    }
  }

  /**
   * Append text to the last non-system message in the array.
   */
  private appendToLastMessage(
    messages: Array<{ role: string; content: string; timestamp?: string }>,
    text: string
  ): void {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role !== 'system') {
        messages[i].content += text
        return
      }
    }
    // Fallback: append to last message if no non-system found
    if (messages.length > 0) {
      messages[messages.length - 1].content += text
    }
  }
}
