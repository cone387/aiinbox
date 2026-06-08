import { Platform, UnifiedConversation } from '../types'
import { PlatformAdapter, CapturedResponse, ParseResult } from './base'

// DeepSeek web chat (chat.deepseek.com) uses a custom CRDT-style SSE protocol.
// Verified via Playwright capture:
//
//   Turn:    POST /api/v0/chat/completion — SSE stream
//     Request body: { chat_session_id, prompt, model_type, thinking_enabled, search_enabled, ... }
//     SSE events:
//       event: ready            → {request_message_id, response_message_id}
//       event: update_session   → {updated_at}
//       data: {"v":{"response":{fragments:[{type:"RESPONSE",content:"..."}],...}}}
//       data: {"p":"response/fragments/-1/content","o":"APPEND","v":"..."}
//       data: {"v":"..."}        — bare string append
//       data: {"p":"response","o":"BATCH","v":[...]}
//       data: {"p":"response/status","o":"SET","v":"FINISHED"}
//       event: title            → {content:"..."}
//       event: close
//
//   History: GET /api/v0/chat/history_messages?chat_session_id=...
//     Response: {data:{biz_data:{chat_session:{...}, chat_messages:[{role,fragments:[{type,content}]}]}}}
//     Fragment types: REQUEST (user), THINK (thinking), RESPONSE (assistant), TIP (disclaimer)
//
//   List:    GET /api/v0/chat_session/fetch_page
//     Response: {data:{biz_data:{chat_sessions:[{id,title,updated_at}],has_more}}}

type RawMsg = { role: string; content: string; timestamp?: string }

export class DeepSeekAdapter extends PlatformAdapter {
  platform: Platform = 'deepseek'

  urlPatterns = [
    'https://chat.deepseek.com/api/v0/chat/completion',
    'https://chat.deepseek.com/api/v0/chat/history_messages',
    'https://chat.deepseek.com/api/v0/chat_session/fetch_page',
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

      if (response.captureMode === 'history') {
        return this.parseHistoryResponseBody(body)
      }

      // Turn mode: SSE stream
      return this.parseSSEResponse(body, response.isComplete, response.requestBody)
    } catch (err) {
      return { success: false, error: 'DeepSeek parse error: ' + String(err) }
    }
  }

  // ===== Turn: SSE stream from /api/v0/chat/completion =====
  private parseSSEResponse(body: string, isComplete: boolean, requestBody?: string): ParseResult {
    const lines = body.split('\n')
    let assistantContent = ''
    let conversationId = ''
    let title = ''

    // Track whether we've seen the initial response fragment
    let seenInitialFragment = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()

      // Skip empty lines and event-only lines (event data follows on next data: line)
      if (!line || line.startsWith('event:')) continue
      if (!line.startsWith('data:')) continue

      const data = line.slice(5).trim()

      try {
        const parsed = JSON.parse(data)

        // === Initial response fragment ===
        // {"v":{"response":{"fragments":[{"type":"RESPONSE","content":"..."}],...}}}
        if (parsed.v?.response?.fragments && !seenInitialFragment) {
          seenInitialFragment = true
          const fragments = parsed.v.response.fragments
          for (const frag of fragments) {
            if (frag.type === 'RESPONSE' && typeof frag.content === 'string') {
              assistantContent += frag.content
            }
          }
          continue
        }

        // === CRDT operations ===
        // APPEND to response content:
        // {"p":"response/fragments/-1/content","o":"APPEND","v":"..."}
        if (parsed.o === 'APPEND' && typeof parsed.v === 'string') {
          if (parsed.p?.includes('content') || !parsed.p) {
            assistantContent += parsed.v
          }
          continue
        }

        // Bare string value append: {"v":"..."}
        if (typeof parsed.v === 'string' && parsed.o === undefined && parsed.p === undefined) {
          assistantContent += parsed.v
          continue
        }

        // BATCH operations: {"p":"response","o":"BATCH","v":[...]}
        // We mostly care about status updates, skip for now
        if (parsed.o === 'BATCH' && Array.isArray(parsed.v)) {
          // Could contain nested operations, but content is already streamed above
          continue
        }

        // SET status: {"p":"response/status","o":"SET","v":"FINISHED"}
        // Just a status marker, no content
      } catch {
        // Skip unparseable lines
      }
    }

    // Extract title from event: title line
    // Format: event: title\ndata: {"content":"..."}
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === 'event: title' || lines[i].trim() === 'event:title') {
        // Next data: line has the title
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j].trim()
          if (nextLine.startsWith('data:')) {
            try {
              const titleData = JSON.parse(nextLine.slice(5).trim())
              if (typeof titleData.content === 'string') {
                title = titleData.content
              }
            } catch {}
            break
          }
        }
        break
      }
    }

    // Extract user message from request body (prompt field)
    const messages: RawMsg[] = []
    let userText = ''
    if (requestBody) {
      userText = this.extractUserTextFromRequest(requestBody)
      conversationId = this.extractSessionId(requestBody)
    }
    if (userText) {
      messages.push({ role: 'user', content: userText, timestamp: this.nowISO() })
    }

    if (assistantContent) {
      messages.push({ role: 'assistant', content: assistantContent, timestamp: this.nowISO() })
    }

    if (messages.length === 0) {
      return { success: false, error: 'No messages found in DeepSeek SSE response' }
    }

    if (!title) {
      title = userText ? userText.slice(0, 50) : 'DeepSeek Chat'
    }

    const conversation: UnifiedConversation = {
      id: this.generateId(),
      platform: this.platform,
      conversationId: conversationId || this.generateId(),
      title,
      messages: messages.map((m) =>
        this.createMessage(this.mapRole(m.role), m.content, m.timestamp, isComplete)
      ),
      createdAt: messages[0]?.timestamp || this.nowISO(),
      updatedAt: messages[messages.length - 1]?.timestamp || this.nowISO(),
    }

    return { success: true, conversation }
  }

  // ===== History: GET /api/v0/chat/history_messages =====
  private parseHistoryResponseBody(body: string): ParseResult {
    try {
      const data = JSON.parse(body)
      const bizData = data?.data?.biz_data || data?.biz_data
      if (!bizData) {
        return { success: false, error: 'No biz_data in DeepSeek history response' }
      }

      // Could be a chat_session list or a single conversation's messages
      const chatMessages = bizData.chat_messages
      const chatSession = bizData.chat_session

      if (Array.isArray(chatMessages) && chatMessages.length > 0) {
        return this.parseChatMessages(chatMessages, chatSession)
      }

      // Conversation list (fetch_page)
      const sessions = bizData.chat_sessions
      if (Array.isArray(sessions)) {
        // List response doesn't have full messages, not useful for capture
        return { success: false, error: 'Conversation list without messages' }
      }

      return { success: false, error: 'Unrecognized DeepSeek history format' }
    } catch {
      return { success: false, error: 'Failed to parse DeepSeek history response' }
    }
  }

  private parseChatMessages(chatMessages: any[], session?: any): ParseResult {
    const messages: RawMsg[] = []

    for (const msg of chatMessages) {
      const role = (msg.role || '').toUpperCase()
      if (role === 'SYSTEM') continue

      // Format A: direct content field (history API)
      //   { role: "USER", content: "...", inserted_at: 1234567890.123 }
      // Format B: fragments array (turn SSE initial payload)
      //   { role: "USER", fragments: [{type: "REQUEST", content: "..."}] }
      if (typeof msg.content === 'string' && msg.content.length > 0) {
        if (role === 'USER') {
          messages.push({
            role: 'user',
            content: msg.content,
            timestamp: msg.inserted_at
              ? new Date(msg.inserted_at * 1000).toISOString()
              : undefined,
          })
        } else if (role === 'ASSISTANT') {
          messages.push({
            role: 'assistant',
            content: msg.content,
            timestamp: msg.inserted_at
              ? new Date(msg.inserted_at * 1000).toISOString()
              : undefined,
          })
        }
        // Skip thinking_content and tips
        continue
      }

      const fragments = msg.fragments
      if (!Array.isArray(fragments)) continue

      for (const frag of fragments) {
        const fragType = frag.type
        const content = typeof frag.content === 'string' ? frag.content : ''
        if (!content) continue

        if (fragType === 'REQUEST' && role === 'USER') {
          messages.push({
            role: 'user',
            content,
            timestamp: msg.inserted_at
              ? new Date(msg.inserted_at * 1000).toISOString()
              : undefined,
          })
        } else if (fragType === 'RESPONSE' && role === 'ASSISTANT') {
          messages.push({
            role: 'assistant',
            content,
            timestamp: msg.inserted_at
              ? new Date(msg.inserted_at * 1000).toISOString()
              : undefined,
          })
        }
      }
    }

    if (messages.length === 0) {
      return { success: false, error: 'No messages in DeepSeek conversation' }
    }

    const conversationId = session?.id || ''
    const title = session?.title || messages.find((m) => m.role === 'user')?.content.slice(0, 50) || 'DeepSeek Chat'

    const conversation: UnifiedConversation = {
      id: this.generateId(),
      platform: this.platform,
      conversationId: conversationId || this.generateId(),
      title,
      messages: messages.map((m) =>
        this.createMessage(this.mapRole(m.role), m.content, m.timestamp, true)
      ),
      createdAt: messages[0]?.timestamp || this.nowISO(),
      updatedAt: messages[messages.length - 1]?.timestamp || this.nowISO(),
    }

    return { success: true, conversation }
  }

  // Extract user prompt from POST request body.
  // DeepSeek format: { prompt: "user message", chat_session_id: "..." }
  private extractUserTextFromRequest(requestBody: string): string {
    try {
      const data = JSON.parse(requestBody)
      if (typeof data.prompt === 'string') return data.prompt
    } catch {}
    return ''
  }

  // Extract chat_session_id from request body
  private extractSessionId(requestBody: string): string {
    try {
      const data = JSON.parse(requestBody)
      if (typeof data.chat_session_id === 'string') return data.chat_session_id
    } catch {}
    return ''
  }
}
