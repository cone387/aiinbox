import { Platform, SyncStatus, UnifiedConversation } from '../types'
import { PlatformAdapter, CapturedResponse, ParseResult } from './base'

export class GeminiAdapter extends PlatformAdapter {
  platform = Platform.Gemini
  urlPatterns = [
    'https://gemini.google.com/_/BardChatUi/data/',
    'https://gemini.google.com/app/_/data/',
  ]

  matchRequest(url: string): boolean {
    return this.urlPatterns.some((pattern) => url.includes(pattern))
  }

  parseResponse(response: CapturedResponse): ParseResult {
    try {
      // Gemini uses a custom response format with nested arrays
      // The response starts with ")]}\n" followed by JSON
      let body = response.body
      if (body.startsWith(')]}\'\n')) {
        body = body.slice(5)
      }

      const messages: Array<{ role: string; content: string }> = []
      let conversationId = ''

      // Try to parse the nested array structure
      try {
        const parsed = JSON.parse(body)
        // Gemini response is deeply nested arrays
        // Structure varies, attempt common patterns
        if (Array.isArray(parsed)) {
          this.extractGeminiMessages(parsed, messages)
          conversationId = this.extractConversationId(parsed)
        }
      } catch {
        // Try line-by-line parsing for streaming responses
        const lines = body.split('\n')
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line)
            if (Array.isArray(parsed)) {
              this.extractGeminiMessages(parsed, messages)
            }
          } catch {
            // Skip
          }
        }
      }

      if (messages.length === 0) {
        return { success: false, error: 'No messages found in Gemini response' }
      }

      const conversation: UnifiedConversation = {
        id: this.generateId(),
        platform: this.platform,
        conversationId: conversationId || this.generateId(),
        title: messages[0]?.content.slice(0, 50) || 'Gemini Chat',
        messages: messages.map((m) =>
          this.createMessage(this.mapRole(m.role), m.content, undefined, response.isComplete)
        ),
        createdAt: this.nowISO(),
        updatedAt: this.nowISO(),
        syncStatus: SyncStatus.Pending,
      }

      return { success: true, conversation }
    } catch (err) {
      return { success: false, error: `Gemini parse error: ${err}` }
    }
  }

  private extractGeminiMessages(
    data: unknown[],
    messages: Array<{ role: string; content: string }>
  ): void {
    // Recursively search for text content in nested arrays
    const search = (arr: unknown[]): void => {
      for (const item of arr) {
        if (Array.isArray(item)) {
          // Look for [text, role_indicator] patterns
          if (typeof item[0] === 'string' && item[0].length > 10) {
            // Heuristic: long strings are likely message content
            messages.push({ role: 'assistant', content: item[0] })
          } else {
            search(item)
          }
        }
      }
    }
    search(data)
  }

  private extractConversationId(data: unknown[]): string {
    // Try to find conversation ID in the response
    const search = (arr: unknown[]): string => {
      for (const item of arr) {
        if (typeof item === 'string' && item.startsWith('c_') && item.length > 10) {
          return item
        }
        if (Array.isArray(item)) {
          const result = search(item)
          if (result) return result
        }
      }
      return ''
    }
    return search(data)
  }
}
