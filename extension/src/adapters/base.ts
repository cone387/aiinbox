import { Platform, UnifiedConversation, UnifiedMessage, MessageRole } from '../types'

export interface CapturedResponse {
  requestId: string
  tabId: number
  platform: Platform
  url: string
  statusCode: number
  body: string
  isComplete: boolean
  timestamp: string
}

export interface ParseResult {
  success: boolean
  conversation?: UnifiedConversation
  error?: string
  warnings?: string[]
}

export abstract class PlatformAdapter {
  abstract platform: Platform
  abstract urlPatterns: string[]

  abstract matchRequest(url: string): boolean
  abstract parseResponse(response: CapturedResponse): ParseResult

  protected generateId(): string {
    return crypto.randomUUID()
  }

  protected mapRole(role: string): MessageRole {
    const roleMap: Record<string, MessageRole> = {
      user: 'user',
      human: 'user',
      assistant: 'assistant',
      model: 'assistant',
      bot: 'assistant',
      system: 'system',
    }
    return roleMap[role.toLowerCase()] || 'unknown'
  }

  protected createMessage(
    role: MessageRole,
    content: string,
    timestamp?: string,
    isComplete = true
  ): UnifiedMessage {
    return {
      id: this.generateId(),
      role,
      content,
      timestamp: timestamp || new Date().toISOString(),
      isComplete,
    }
  }

  protected nowISO(): string {
    return new Date().toISOString()
  }
}
