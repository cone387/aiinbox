import { Platform, UnifiedConversation } from '../types'
import { PlatformAdapter, CapturedResponse, ParseResult } from './base'

// Tongyi / Qianwen (通义千问) web API, verified via Playwright capture:
//
//   Turn:    POST https://chat2.qianwen.com/api/v2/chat — SSE stream
//     Request body: { req_id, session_id, messages: [{mime_type, content, ...}], model, ... }
//     SSE format: only `data:` lines (no `event:` lines), each data line is JSON.
//     Key fields per SSE data packet:
//       communication.sessionid   — session id
//       communication.reqid       — request id
//       data.messages[0].content  — ACCUMULATED assistant text (not delta)
//       data.messages[0].status   — "processing" | "complete"
//       data.messages[0].mime_type — "multi_load/iframe" (text), "signal/post" (initial)
//       data.extra_info.ori_query — original user query (in first signal packet)
//
//   History: GET https://chat2-api.qianwen.com/api/v1/session/msg/list?session_id=...
//     Response JSON:
//       { code: 0, data: { have_next_page, list: [{ user_type, session_id, req_id,
//         request_messages: [{content, mime_type}],
//         response_messages: [{content, mime_type, status}],
//         created_at (ms), updated_at (ms) }] } }
//
//   List:    POST https://chat2-api.qianwen.com/api/v2/session/page/list
//     Request: { limit, next_token, sort_field, need_filter_tag }
//     Response: { code: 0, data: { have_next_page, next_token,
//       list: [{ session_id, title, created_at (ms), updated_at (ms) }] } }

type RawMsg = { role: string; content: string; timestamp?: string }

export class TongyiAdapter extends PlatformAdapter {
  platform: Platform = 'tongyi'

  urlPatterns = [
    // Turn (POST): SSE stream
    'chat2.qianwen.com/api/v2/chat',
    // History (GET): message list per session
    'chat2-api.qianwen.com/api/v1/session/msg/list',
    // Session list (POST): for full-sync listing
    'chat2-api.qianwen.com/api/v2/session/page/list',
  ]

  matchRequest(url: string): boolean {
    return this.urlPatterns.some((pattern) => url.includes(pattern))
  }

  parseResponse(response: CapturedResponse): ParseResult {
    try {
      if (response.captureMode === 'history') {
        return this.parseHistoryResponse(response)
      }
      return this.parseTurnResponse(response)
    } catch (err) {
      return { success: false, error: 'Tongyi parse error: ' + String(err) }
    }
  }

  // ===== Turn: SSE stream from /api/v2/chat =====
  // Content is ACCUMULATED — each data packet's messages[0].content contains
  // the full text up to that point. We just need the last complete packet.
  private parseTurnResponse(response: CapturedResponse): ParseResult {
    const body = response.body.trim()
    if (!body) return { success: false, error: 'Empty response body' }

    let conversationId = ''
    let assistantText = ''
    let userText = ''

    // Parse all data lines; take the last one with status=complete for content.
    // Also look for the signal/post packet which carries ori_query.
    for (const line of body.split('\n')) {
      const trimmed = line.replace(/\r$/, '').trim()
      if (!trimmed.startsWith('data:')) continue
      const jsonStr = trimmed.slice(5).trim()
      if (!jsonStr) continue

      let parsed: any
      try { parsed = JSON.parse(jsonStr) } catch { continue }

      // Extract session id
      const sid = parsed?.communication?.sessionid
      if (sid && !conversationId) conversationId = sid

      // Extract user query from signal/post packet
      const oriQuery = parsed?.data?.extra_info?.ori_query
      if (typeof oriQuery === 'string' && oriQuery) userText = oriQuery

      // Accumulated assistant text — keep overwriting; last complete wins
      const msgs = parsed?.data?.messages
      if (Array.isArray(msgs) && msgs.length > 0) {
        const msg = msgs[0]
        if (typeof msg.content === 'string' && msg.content) {
          assistantText = msg.content
        }
      }
    }

    // Fallback: extract user text from request body
    if (!userText && response.requestBody) {
      userText = this.extractUserTextFromRequest(response.requestBody)
    }
    if (!conversationId && response.requestBody) {
      conversationId = this.extractSessionId(response.requestBody)
    }

    const messages: RawMsg[] = []
    if (userText) messages.push({ role: 'user', content: userText, timestamp: this.nowISO() })
    if (assistantText) messages.push({ role: 'assistant', content: assistantText, timestamp: this.nowISO() })

    if (messages.length === 0) {
      return { success: false, error: 'No messages found in Tongyi SSE response' }
    }

    const title = this.titleFromPage(response.pageTitle) || userText.slice(0, 50) || '通义千问'

    const conversation: UnifiedConversation = {
      id: this.generateId(),
      platform: this.platform,
      conversationId: conversationId || this.generateId(),
      title,
      messages: messages.map((m) =>
        this.createMessage(this.mapRole(m.role), m.content, m.timestamp, response.isComplete)
      ),
      createdAt: messages[0]?.timestamp || this.nowISO(),
      updatedAt: messages[messages.length - 1]?.timestamp || this.nowISO(),
    }
    return { success: true, conversation }
  }

  // ===== History: JSON from /api/v1/session/msg/list =====
  private parseHistoryResponse(response: CapturedResponse): ParseResult {
    const data = JSON.parse(response.body)
    const list = data?.data?.list
    if (!Array.isArray(list) || list.length === 0) {
      return { success: false, error: 'No messages in Tongyi history response' }
    }

    let conversationId = ''
    const messages: RawMsg[] = []

    for (const item of list) {
      if (!conversationId && item?.session_id) conversationId = String(item.session_id)

      const createdAt = typeof item.created_at === 'number' && item.created_at > 0
        ? new Date(item.created_at).toISOString()
        : undefined

      // User messages
      const reqMsgs = item.request_messages
      if (Array.isArray(reqMsgs)) {
        for (const rm of reqMsgs) {
          const text = typeof rm.content === 'string' ? rm.content : ''
          if (text) messages.push({ role: 'user', content: text, timestamp: createdAt })
        }
      }

      // Assistant messages
      const respMsgs = item.response_messages
      if (Array.isArray(respMsgs)) {
        for (const rm of respMsgs) {
          const text = typeof rm.content === 'string' ? rm.content : ''
          if (text) {
            const ts = typeof item.updated_at === 'number' && item.updated_at > 0
              ? new Date(item.updated_at).toISOString()
              : createdAt
            messages.push({ role: 'assistant', content: text, timestamp: ts })
          }
        }
      }
    }

    if (messages.length === 0) {
      return { success: false, error: 'No text messages in Tongyi history response' }
    }

    const title = this.titleFromPage(response.pageTitle) || messages.find((m) => m.role === 'user')?.content.slice(0, 50) || '通义千问'

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

  // Tongyi page title: "<real title> - 通义千问" or similar
  private titleFromPage(pageTitle?: string): string {
    if (!pageTitle) return ''
    let t = pageTitle.replace(/\s*[-–|]\s*通义千问\s*$/, '').trim()
    if (!t || t === '通义千问' || t === '新对话' || t.includes('阿里云')) return ''
    // Also handle qianwen.com branding
    t = t.replace(/\s*[-–|]\s*Qianwen\s*$/i, '').trim()
    if (!t || t.toLowerCase() === 'qianwen') return ''
    return t.slice(0, 50)
  }

  // Request body: { messages: [{content, mime_type}], session_id }
  private extractUserTextFromRequest(requestBody: string): string {
    try {
      const data = JSON.parse(requestBody)
      const msgs = data?.messages
      if (Array.isArray(msgs)) {
        for (const m of msgs) {
          if (typeof m.content === 'string' && m.content) return m.content
        }
      }
    } catch {}
    return ''
  }

  private extractSessionId(requestBody: string): string {
    try {
      const data = JSON.parse(requestBody)
      if (typeof data.session_id === 'string') return data.session_id
    } catch {}
    return ''
  }
}
