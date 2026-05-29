import { Platform, UnifiedConversation } from '../types'
import { PlatformAdapter, CapturedResponse, ParseResult } from './base'

export class ChatGPTAdapter extends PlatformAdapter {
  platform: Platform = 'chatgpt'
  urlPatterns = [
    'https://chat.openai.com/backend-api/conversation',
    'https://chatgpt.com/backend-api/conversation',
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

      // ChatGPT streaming response: lines starting with "data: "
      if (body.includes('data: ')) {
        return this.parseSSEResponse(body, response.isComplete)
      }

      // JSON response (fetching existing conversation)
      if (body.startsWith('{')) {
        return this.parseJSONResponse(body)
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
        if (parsed.conversation_id) {
          conversationId = parsed.conversation_id
        }
        if (parsed.title) {
          title = parsed.title
        }

        // Extract message content from streaming chunks
        if (parsed.message?.content?.parts) {
          const role = parsed.message.author?.role || 'assistant'
          const content = parsed.message.content.parts.join('')
          if (content) {
            // Keep only the latest version of each message (streaming sends cumulative)
            const existingIdx = messages.findIndex(
              (m) => m.role === role && parsed.message?.id
            )
            if (existingIdx >= 0) {
              messages[existingIdx].content = content
            } else {
              messages.push({
                role,
                content,
                timestamp: parsed.message.create_time
                  ? new Date(parsed.message.create_time * 1000).toISOString()
                  : undefined,
              })
            }
          }
        }
      } catch {
        // Skip unparseable lines
      }
    }

    if (messages.length === 0) {
      return { success: false, error: 'No messages found in SSE response' }
    }

    // Deduplicate: keep only the last message per role (streaming sends updates)
    const dedupedMessages = this.deduplicateMessages(messages)

    const conversation: UnifiedConversation = {
      id: this.generateId(),
      platform: this.platform,
      conversationId: conversationId || this.generateId(),
      title: title || dedupedMessages[0]?.content.slice(0, 50) || 'Untitled',
      messages: dedupedMessages.map((m) =>
        this.createMessage(this.mapRole(m.role), m.content, m.timestamp, isComplete)
      ),
      createdAt: dedupedMessages[0]?.timestamp || this.nowISO(),
      updatedAt: dedupedMessages[dedupedMessages.length - 1]?.timestamp || this.nowISO(),
      syncStatus: 'pending',
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
        syncStatus: 'pending',
      }

      return { success: true, conversation }
    } catch {
      return { success: false, error: 'Failed to parse JSON response' }
    }
  }

  private deduplicateMessages(messages: Array<{ role: string; content: string; timestamp?: string }>) {
    // ChatGPT streaming sends cumulative content updates for the same message
    // Keep only unique messages by content (last occurrence wins)
    const seen = new Map<string, typeof messages[0]>()
    for (const msg of messages) {
      const key = msg.role + ':' + (msg.timestamp || 'latest')
      seen.set(key, msg)
    }
    return Array.from(seen.values())
  }
}
