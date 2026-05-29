export enum Platform {
  ChatGPT = 'chatgpt',
  Gemini = 'gemini',
  Tongyi = 'tongyi',
  Doubao = 'doubao',
}

export enum SyncStatus {
  Pending = 'pending',
  Syncing = 'syncing',
  Synced = 'synced',
  Failed = 'failed',
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'unknown'

export interface UnifiedMessage {
  id: string
  role: MessageRole
  content: string
  timestamp: string // ISO 8601
  isComplete: boolean
}

export interface UnifiedConversation {
  id: string
  platform: Platform
  conversationId: string
  title: string
  messages: UnifiedMessage[]
  createdAt: string
  updatedAt: string
  syncStatus: SyncStatus
}

export interface ExtensionConfig {
  serverUrl: string
  authToken: string
  syncMode: 'realtime' | 'batch'
  batchInterval: number // minutes
  enabledPlatforms: Platform[]
  isCollecting: boolean
}

export interface PlatformStats {
  platform: Platform
  collected: number
  pendingSync: number
}

export type ExtensionStatus = 'active' | 'paused' | 'error'
