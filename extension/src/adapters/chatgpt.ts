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
      const lines = response.body.split('\n').filter((l) => l.startsWith('data: '))
      const messages: Array<{ role: string; content: string; timestamp?: string }> = []
      let conversationId = ''
      let title = ''

      for (const line of lines) {
        const data = line.slice(6) // Remove "data: "
        if (data === '[DONE]') break

        try {
          const parsed = JSON.parse(data)
          if (parsed.conversation_id) {
            conversationId = parsed.conversation_id
          }
          if (parsed.title) {
            title = parsed.title
          }

          if (parsed.message?.content?.parts) {
            const role = parsed.message.author?.role || 'assistant'
            const content = parsed.message.content.parts.join('')
            if (content) {
              messages.push({
                role,
                content,
                timestamp: parsed.message.create_time
                  ? new Date(parsed.message.create_time * 1000).toISOString()
                  : undefined,
              })
            }
          }
        } catch {
          // Skip unparseable lines
        }
      }

      if (messages.length === 0) {
        return { success: false, error: 'No messages found in response' }
      }

      const conversation: UnifiedConversation = {
        id: this.generateId(),
        platform: this.platform,
        conversationId: conversationId || this.generateId(),
        title: title || messages[0]?.content.slice(0, 50) || 'Untitled',
        messages: messages.map((m) =>
          this.createMessage(this.mapRole(m.role), m.content, m.timestamp, response.isComplete)
        ),
        createdAt: messages[0]?.timestamp || this.nowISO(),
        updatedAt: messages[messages.length - 1]?.timestamp || this.nowISO(),
        syncStatus: 'pending',
      }

      return { success: true, conversation }
    } catch (err) {
      return { success: false, error: `ChatGPT parse error: ${err}` }
    }
  }
}
