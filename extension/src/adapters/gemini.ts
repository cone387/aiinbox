import { Platform, UnifiedConversation, UnifiedMessage } from '../types'
import { PlatformAdapter, CapturedResponse, ParseResult } from './base'

/**
 * Gemini (Google) adapter.
 *
 * API overview (captured via Playwright 2026-06):
 * - Turn: POST /_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate
 *   Response: Google streaming envelope with multiple chunks. Each chunk is
 *   `[["wrb.fr", null, "<jsonStr>"]]`. The last chunk with `data[4]` (messages
 *   array) contains the accumulated assistant text at `data[4][0][1]`.
 * - History: POST /_/BardChatUi/data/batchexecute?rpcids=hNvQHb
 *   Response: Google envelope → inner JSON = `[turnsArray, null, null, meta]`.
 *   Each turn = `[userIds, respIds, userData, respData, [sec, nano]]`.
 *   User text = `turn[2][0][0]`, Assistant text = `turn[3][0][0][1]`.
 *
 * Google envelope format: `)]}'\n\n<len>\n[[...]]\n<len>\n[[...]]\n...`
 * Each `[[...]]` line is a JSON array: `[["wrb.fr", rpcId, innerJsonStr, ...]]`.
 */
export class GeminiAdapter extends PlatformAdapter {
  platform: Platform = 'gemini'

  urlPatterns = [
    '/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate',
    '/_/BardChatUi/data/batchexecute',
  ]

  matchRequest(url: string): boolean {
    return this.urlPatterns.some((p) => url.includes(p))
  }

  parseResponse(response: CapturedResponse): ParseResult {
    if (response.captureMode === 'history') {
      return this.parseHistoryResponse(response)
    }
    return this.parseTurnResponse(response)
  }

  // ── Google envelope parser ──────────────────────────────────────────
  /**
   * Parse Google's streaming batchexecute envelope and return all inner
   * JSON objects (one per chunk).
   */
  private parseGoogleEnvelope(body: string): any[] {
    const results: any[] = []
    const lines = body.split('\n')
    for (const line of lines) {
      if (!line.startsWith('[[')) continue
      try {
        const outer = JSON.parse(line)
        const innerStr = outer[0]?.[2]
        if (typeof innerStr === 'string' && innerStr.length > 0) {
          results.push(JSON.parse(innerStr))
        }
      } catch {
        // skip malformed lines
      }
    }
    return results
  }

  // ── Turn (StreamGenerate) ──────────────────────────────────────────
  private parseTurnResponse(response: CapturedResponse): ParseResult {
    const chunks = this.parseGoogleEnvelope(response.body)
    if (chunks.length === 0) {
      return { success: false, error: 'Gemini turn: no valid chunks in response' }
    }

    // Find the last chunk that has a messages array at index 4
    let assistantText = ''
    let convId = ''
    let requestId = ''

    for (let i = chunks.length - 1; i >= 0; i--) {
      const c = chunks[i]
      // Extract conv/request IDs from c[1]
      if (Array.isArray(c[1])) {
        const rawConvId = c[1][0]
        const rawReqId = c[1][1]
        if (typeof rawConvId === 'string') convId = rawConvId.replace(/^c_/, '')
        if (typeof rawReqId === 'string') requestId = rawReqId.replace(/^r_/, '')
      }
      // Extract text from c[4][0][1]
      if (Array.isArray(c[4]) && c[4].length > 0) {
        const msg = c[4][0]
        if (Array.isArray(msg) && Array.isArray(msg[1])) {
          // msg[1] is an array of text segments
          assistantText = msg[1].filter((t: any) => typeof t === 'string').join('')
          if (assistantText) break // found text, stop searching
        }
      }
    }

    if (!assistantText) {
      return { success: false, error: 'Gemini turn: no assistant text found' }
    }

    // Extract user text from the request body
    const userText = this.extractUserTextFromRequestBody(response.requestBody)

    const messages: UnifiedMessage[] = []
    if (userText) {
      messages.push(this.createMessage('user', userText))
    }
    messages.push(this.createMessage('assistant', assistantText))

    const title = this.titleFromPage(response.pageTitle) || userText?.substring(0, 50) || 'Gemini Chat'

    const conversation: UnifiedConversation = {
      id: convId || this.generateId(),
      platform: this.platform,
      title,
      messages,
      createdAt: this.nowISO(),
      updatedAt: this.nowISO(),
    }

    return { success: true, conversation }
  }

  /**
   * Extract the user's message text from the StreamGenerate request body.
   * Format: `f.req=<urlEncoded>[null, "<innerJson>"]` where inner JSON is
   * `[[["user text", 0, null, ...], ...], ...]`.
   */
  private extractUserTextFromRequestBody(requestBody?: string): string {
    if (!requestBody) return ''
    try {
      // URL-decode if needed
      const decoded = requestBody.includes('%') ? decodeURIComponent(requestBody) : requestBody
      // Find f.req value
      const fReqMatch = decoded.match(/f\.req=(.+?)(?:&|$)/)
      if (!fReqMatch) return ''
      const fReq = JSON.parse(fReqMatch[1])
      // fReq = [null, "<innerJsonStr>"]
      const innerStr = fReq[1]
      if (typeof innerStr !== 'string') return ''
      const inner = JSON.parse(innerStr)
      // inner[0][0] = user text
      if (Array.isArray(inner) && Array.isArray(inner[0])) {
        const text = inner[0][0]
        return typeof text === 'string' ? text : ''
      }
    } catch {
      // ignore parse errors
    }
    return ''
  }

  // ── History (hNvQHb) ───────────────────────────────────────────────
  private parseHistoryResponse(response: CapturedResponse): ParseResult {
    const chunks = this.parseGoogleEnvelope(response.body)
    if (chunks.length === 0) {
      return { success: false, error: 'Gemini history: no valid chunks' }
    }

    // The hNvQHb response is a single chunk: [turnsArray, null, null, meta]
    const data = chunks[0]
    const turns = data?.[0]
    if (!Array.isArray(turns) || turns.length === 0) {
      return { success: false, error: 'Gemini history: no turns in data[0]' }
    }

    const messages: UnifiedMessage[] = []
    let convId = ''
    let firstTimestamp = ''
    let lastTimestamp = ''

    for (const turn of turns) {
      if (!Array.isArray(turn) || turn.length < 5) continue

      // Extract conversation ID from turn[0] or turn[1]
      if (!convId && Array.isArray(turn[0]) && typeof turn[0][0] === 'string') {
        convId = turn[0][0].replace(/^c_/, '')
      }

      // Timestamp: turn[4] = [seconds, nanoseconds]
      let ts = ''
      if (Array.isArray(turn[4]) && typeof turn[4][0] === 'number') {
        const ms = turn[4][0] * 1000 + Math.floor((turn[4][1] || 0) / 1e6)
        ts = new Date(ms).toISOString()
        if (!firstTimestamp) firstTimestamp = ts
        lastTimestamp = ts
      }

      // User text: turn[2][0][0]
      const userData = turn[2]
      if (Array.isArray(userData) && Array.isArray(userData[0])) {
        const userText = userData[0][0]
        if (typeof userText === 'string' && userText) {
          messages.push(this.createMessage('user', userText, ts))
        }
      }

      // Assistant text: turn[3][0][0][1]
      const respData = turn[3]
      if (Array.isArray(respData) && Array.isArray(respData[0]) && Array.isArray(respData[0][0])) {
        const textArr = respData[0][0][1]
        if (Array.isArray(textArr)) {
          const text = textArr.filter((t: any) => typeof t === 'string').join('')
          if (text) {
            messages.push(this.createMessage('assistant', text, ts))
          }
        }
      }
    }

    if (messages.length === 0) {
      return { success: false, error: 'Gemini history: no messages extracted' }
    }

    const title = this.titleFromPage(response.pageTitle) || 'Gemini Chat'

    const conversation: UnifiedConversation = {
      id: convId || this.generateId(),
      platform: this.platform,
      title,
      messages,
      createdAt: firstTimestamp || this.nowISO(),
      updatedAt: lastTimestamp || this.nowISO(),
    }

    return { success: true, conversation }
  }

  // ── Helpers ─────────────────────────────────────────────────────────
  private titleFromPage(pageTitle?: string): string {
    if (!pageTitle) return ''
    return pageTitle
      .replace(/\s*-\s*Google Gemini\s*$/, '')
      .replace(/\s*-\s*Gemini\s*$/, '')
      .trim()
  }
}
