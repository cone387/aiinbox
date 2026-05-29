import { Platform, SyncStatus, UnifiedConversation } from '../types'
import { PlatformAdapter, CapturedResponse, ParseResult } from './base'

export class DoubaoAdapter extends PlatformAdapter {
  platform = Platform.Doubao
  urlPatterns = [
    'https://www.doubao.com/chat/api/chat',
    'https://doubao.com/chat/api/chat',
    'https://www.doubao.com/samantha/chat/completion',
  ]

  matchRequest(url: string): boolean {
    return this.urlPatterns.some((pattern) => url.includes(pattern))
  }

  parseResponse(response: CapturedResponse): ParseResult {
    try {
      const messages: Array<{ role: string; content: string }> = []
      let conversationId = ''
      let title = ''

      // Doubao uses SSE format
      const lines = response.body.split('\n')

      for (const line of lines) {
        let data = line
        if (line.startsWith('data:')) {
          data = line.slice(5).trim()
        }
        if (!data || data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data)

          if (parsed.conversation_id) {
            conversationId = parsed.conversation_id
          }
          if (parsed.title) {
            title = parsed.title
          }

          // Extract content
          const content =
            parsed.event_data?.text ||
            parsed.data?.text ||
            parsed.choices?.[0]?.delta?.content ||
            parsed.choices?.[0]?.message?.content ||
            ''

          const role =
            parsed.event_data?.role ||
            parsed.choices?.[0]?.delta?.role ||
            parsed.choices?.[0]?.message?.role ||
            'assistant'

          if (content) {
            messages.push({ role, content })
          }
        } catch {
          // Skip unparseable lines
        }
      }

      if (messages.length === 0) {
        return { success: false, error: 'No messages found in Doubao response' }
      }

      // Merge streaming chunks into single message
      const mergedContent = messages
        .filter((m) => m.role === 'assistant')
        .map((m) => m.content)
        .join('')

      const finalMessages = mergedContent
        ? [{ role: 'assistant', content: mergedContent }]
        : messages

      const conversation: UnifiedConversation = {
        id: this.generateId(),
        platform: this.platform,
        conversationId: conversationId || this.generateId(),
        title: title || finalMessages[0]?.content.slice(0, 50) || 'Doubao Chat',
        messages: finalMessages.map((m) =>
          this.createMessage(this.mapRole(m.role), m.content, undefined, response.isComplete)
        ),
        createdAt: this.nowISO(),
        updatedAt: this.nowISO(),
        syncStatus: SyncStatus.Pending,
      }

      return { success: true, conversation }
    } catch (err) {
      return { success: false, error: `Doubao parse error: ${err}` }
    }
  }
}
