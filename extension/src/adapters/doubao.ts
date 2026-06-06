import { Platform, UnifiedConversation } from '../types'
import { PlatformAdapter, CapturedResponse, ParseResult } from './base'

// Doubao (豆包) web API, verified via live capture:
//   Turn:    POST /chat/completion        — SSE stream (event/data lines)
//   History: POST /im/chain/single        — JSON (cmd 3100 pull-chain protocol)
// Text lives in content_block entries with block_type 10000 → content.text_block.text.
// Other block types (10025 = web search results, etc.) are ignored.
const TEXT_BLOCK_TYPE = 10000

type RawMsg = { role: string; content: string; timestamp?: string }

export class DoubaoAdapter extends PlatformAdapter {
  platform: Platform = 'doubao'

  urlPatterns = [
    'https://www.doubao.com/chat/completion',
    'https://doubao.com/chat/completion',
    'https://www.doubao.com/im/chain/single',
    'https://doubao.com/im/chain/single',
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
      return { success: false, error: 'Doubao parse error: ' + String(err) }
    }
  }

  // Concatenate the visible text of all text blocks in a content_block array.
  private extractBlockText(blocks: any[]): string {
    if (!Array.isArray(blocks)) return ''
    let out = ''
    for (const b of blocks) {
      if (b?.block_type !== TEXT_BLOCK_TYPE) continue
      const text = b?.content?.text_block?.text
      if (typeof text === 'string') out += text
    }
    return out
  }

  // Extract a message's visible text across the two shapes the history API uses:
  //   - assistant (content_type 9999): content_block holds block_type 10000 entries
  //   - user (content_type 1): content_block is empty; the text lives in the
  //     `content` field as a JSON string {"text":"..."}.
  // As a final fallback, `content` may itself be a stringified content_block array.
  private extractMessageText(m: any): string {
    const fromBlocks = this.extractBlockText(m?.content_block)
    if (fromBlocks) return fromBlocks

    const raw = m?.content
    if (typeof raw !== 'string' || !raw) return ''
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.text === 'string') return parsed.text
      if (Array.isArray(parsed)) return this.extractBlockText(parsed)
    } catch {}
    return ''
  }

  // Doubao's response payloads rarely carry a usable conversation title (the
  // SSE_ACK omits conversation_info for the active conversation), so we fall
  // back to the tab title, which reads "<real title> - 豆包". Strip the suffix
  // and reject the placeholder titles shown before a conversation is named.
  private titleFromPage(pageTitle?: string): string {
    if (!pageTitle) return ''
    let t = pageTitle.replace(/\s*[-–|]\s*豆包\s*$/, '').trim()
    if (!t || t === '豆包' || t === '新对话' || t.includes('字节跳动')) return ''
    return t.slice(0, 50)
  }

  // ===== Turn: SSE stream from /chat/completion =====
  // The assistant reply is streamed across three event kinds that must be
  // concatenated in order: STREAM_MSG_NOTIFY (initial block), STREAM_CHUNK with
  // patch_object 1 (block patches), and CHUNK_DELTA ({"text": "..."}). STREAM_CHUNK
  // with patch_object 111 carries a duplicate tts_content and must be skipped.
  private parseTurnResponse(response: CapturedResponse): ParseResult {
    const body = response.body.trim()
    if (!body) return { success: false, error: 'Empty response body' }

    let conversationId = ''
    let title = ''
    let userText = ''
    let userTime: string | undefined
    let assistantText = ''
    let assistantTime: string | undefined
    let briefFallback = ''

    for (const event of this.iterateSSE(body)) {
      const { name, data } = event
      let parsed: any
      try {
        parsed = JSON.parse(data)
      } catch {
        continue
      }

      switch (name) {
        case 'SSE_ACK': {
          const meta = parsed?.ack_client_meta
          if (meta?.conversation_id) conversationId = meta.conversation_id
          const cname = meta?.conversation_info?.name
          if (cname) title = cname
          break
        }
        case 'FULL_MSG_NOTIFY': {
          const msg = parsed?.message
          if (msg?.user_type === 1) {
            const t = this.extractBlockText(msg.content_block)
            if (t) userText = t
            const ct = msg?.create_time
            if (typeof ct === 'number') userTime = new Date(ct * 1000).toISOString()
          }
          break
        }
        case 'STREAM_MSG_NOTIFY': {
          assistantText += this.extractBlockText(parsed?.content?.content_block)
          const ct = parsed?.meta?.create_time
          if (typeof ct === 'number') assistantTime = new Date(ct * 1000).toISOString()
          break
        }
        case 'STREAM_CHUNK': {
          for (const op of parsed?.patch_op || []) {
            if (op?.patch_object === 1) {
              assistantText += this.extractBlockText(op?.patch_value?.content_block)
            }
          }
          break
        }
        case 'CHUNK_DELTA': {
          if (typeof parsed?.text === 'string') assistantText += parsed.text
          break
        }
        case 'SSE_REPLY_END': {
          const brief = parsed?.msg_finish_attr?.brief
          if (typeof brief === 'string' && brief) briefFallback = brief
          break
        }
      }
    }

    // Fall back to the user text carried in the POST body if the response omitted it.
    if (!userText && response.requestBody) {
      userText = this.extractUserTextFromRequest(response.requestBody)
    }
    // brief carries the fully assembled reply; use it only if streaming yielded nothing.
    if (!assistantText) assistantText = briefFallback

    // The user message must sort before the assistant reply (backend orders by
    // timestamp ASC). The SSE rarely omits FULL_MSG_NOTIFY, but when it does we
    // derive the send time from the POST body, and as a last resort pin it just
    // before the assistant so the turn never renders reply-first.
    if (!userTime) userTime = this.extractUserTimeFromRequest(response.requestBody)
    if (!userTime && assistantTime) {
      userTime = new Date(new Date(assistantTime).getTime() - 1000).toISOString()
    }

    const messages: RawMsg[] = []
    if (userText) messages.push({ role: 'user', content: userText, timestamp: userTime })
    if (assistantText) messages.push({ role: 'assistant', content: assistantText, timestamp: assistantTime })

    if (messages.length === 0) {
      return { success: false, error: 'No messages found in Doubao SSE response' }
    }

    const conversation: UnifiedConversation = {
      id: this.generateId(),
      platform: this.platform,
      conversationId: conversationId || this.generateId(),
      title: title || this.titleFromPage(response.pageTitle) || userText.slice(0, 50) || 'Untitled',
      messages: messages.map((m) =>
        this.createMessage(this.mapRole(m.role), m.content, m.timestamp, response.isComplete)
      ),
      createdAt: messages[0]?.timestamp || this.nowISO(),
      updatedAt: messages[messages.length - 1]?.timestamp || this.nowISO(),
    }
    return { success: true, conversation }
  }

  // ===== History: JSON from /im/chain/single =====
  private parseHistoryResponse(response: CapturedResponse): ParseResult {
    const data = JSON.parse(response.body)
    const list = data?.downlink_body?.pull_singe_chain_downlink_body?.messages
    if (!Array.isArray(list) || list.length === 0) {
      return { success: false, error: 'No messages in Doubao history response' }
    }

    let conversationId = ''
    // Carry index_in_conv so we can order reliably: create_time is only
    // second-granular and collides within a turn (user and assistant share it),
    // whereas index_in_conv strictly increases (user < its assistant reply).
    const rows: { msg: RawMsg; order: number }[] = []
    for (const m of list) {
      if (!conversationId && m?.conversation_id) conversationId = String(m.conversation_id)
      const content = this.extractMessageText(m)
      if (!content) continue
      const role = m?.user_type === 1 ? 'user' : 'assistant'
      const ctSec = Number(m?.create_time)
      const order = Number(m?.index_in_conv)
      rows.push({
        msg: {
          role,
          content,
          timestamp: Number.isFinite(ctSec) && ctSec > 0 ? new Date(ctSec * 1000).toISOString() : undefined,
        },
        order: Number.isFinite(order) ? order : 0,
      })
    }

    if (rows.length === 0) {
      return { success: false, error: 'No text messages in Doubao history response' }
    }

    // The chain is returned newest-first; order by index_in_conv ascending so
    // each user message precedes its reply. The backend sorts by timestamp ASC
    // and breaks same-second ties by insertion (rowid) order, so emitting in
    // this order is what makes the turn render question-before-answer.
    rows.sort((a, b) => a.order - b.order)
    const messages = rows.map((r) => r.msg)

    const conversation: UnifiedConversation = {
      id: this.generateId(),
      platform: this.platform,
      conversationId: conversationId || this.generateId(),
      title: this.titleFromPage(response.pageTitle) || messages.find((m) => m.role === 'user')?.content.slice(0, 50) || 'Untitled',
      messages: messages.map((m) =>
        this.createMessage(this.mapRole(m.role), m.content, m.timestamp, true)
      ),
      createdAt: messages[0]?.timestamp || this.nowISO(),
      updatedAt: messages[messages.length - 1]?.timestamp || this.nowISO(),
    }
    return { success: true, conversation }
  }

  // Yield { name, data } for each `event:`/`data:` pair in an SSE stream.
  private *iterateSSE(body: string): Generator<{ name: string; data: string }> {
    let name = ''
    let data = ''
    for (const rawLine of body.split('\n')) {
      const line = rawLine.replace(/\r$/, '')
      if (line === '') {
        if (name && data) yield { name, data }
        name = ''
        data = ''
        continue
      }
      if (line.startsWith('event:')) name = line.slice(6).trim()
      else if (line.startsWith('data:')) data += line.slice(5).trim()
    }
    if (name && data) yield { name, data }
  }

  // Doubao POST body: { messages: [{ content_block: [{ content: { text_block: { text } } }] }] }
  private extractUserTextFromRequest(requestBody: string): string {
    try {
      const data = JSON.parse(requestBody)
      const msgs = data?.messages
      if (Array.isArray(msgs)) {
        for (const m of msgs) {
          const t = this.extractBlockText(m?.content_block)
          if (t) return t
        }
      }
    } catch {}
    return ''
  }

  // The POST body carries the user's send time as option.create_time_ms (epoch ms),
  // which predates the assistant reply — a reliable ordering key when the SSE
  // dropped FULL_MSG_NOTIFY.
  private extractUserTimeFromRequest(requestBody?: string): string | undefined {
    if (!requestBody) return undefined
    try {
      const ms = JSON.parse(requestBody)?.option?.create_time_ms
      if (typeof ms === 'number' && ms > 0) return new Date(ms).toISOString()
    } catch {}
    return undefined
  }
}
