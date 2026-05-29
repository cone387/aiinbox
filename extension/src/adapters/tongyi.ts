import { Platform, SyncStatus, UnifiedConversation } from '../types'
import { PlatformAdapter, CapturedResponse, ParseResult } from './base'

export class TongyiAdapter extends PlatformAdapter {
  platform = Platform.Tongyi
  urlPatterns = [
    'https://qianwen.biz.aliyun.com/dialog/conversation',
    'https://tongyi.aliyun.com/qianwen/api/chat',
    'https://qianwen.aliyun.com/api/chat',
  ]

  matchRequest(url: string): boolean {
    return this.urlPatterns.some((pattern) => url.includes(pattern))
  }

  parseResponse(response: CapturedResponse): ParseResult {
    try {
      const messages: Array<{ role: string; content: string; timestamp?: string }> = []
      let conversationId = ''
      let title = ''

      // Tongyi uses SSE format with "data:" prefix
      const lines = response.body.split('\n')

      for (const line of lines) {
        let data = line
        if (line.startsWith('data:')) {
          data = line.slice(5).trim()
        }
        if (!data || data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data)

          if (parsed.sessionId || parsed.msgId) {
            conversationId = parsed.sessionId || parsed.msgId || conversationId
          }
          if (parsed.sessionTitle) {
            title = parsed.sessionTitle
          }

          // Extract content from various response formats
          const content =
            parsed.contents?.[0]?.content ||
            parsed.content ||
            parsed.text ||
            parsed.result?.text ||
            ''

          const role = parsed.role || parsed.contents?.[0]?.role || 'assistant'

          if (content) {
            messages.push({ role, content, timestamp: parsed.gmtCreate })
          }
        } catch {
          // Skip unparseable lines
        }
      }

      if (messages.length === 0) {
        return { success: false, error: 'No messages found in Tongyi response' }
      }

      const conversation: UnifiedConversation = {
        id: this.generateId(),
        platform: this.platform,
        conversationId: conversationId || this.generateId(),
        title: title || messages[0]?.content.slice(0, 50) || 'Tongyi Chat',
        messages: messages.map((m) =>
          this.createMessage(this.mapRole(m.role), m.content, m.timestamp, response.isComplete)
        ),
        createdAt: this.nowISO(),
        updatedAt: this.nowISO(),
        syncStatus: SyncStatus.Pending,
      }

      return { success: true, conversation }
    } catch (err) {
      return { success: false, error: `Tongyi parse error: ${err}` }
    }
  }
}
