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
  timestamp: string
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

export interface ServerConfig {
  url: string
  token: string
  name: string
  isDefault: boolean
  healthy?: boolean
}

export interface ExtensionConfig {
  servers: ServerConfig[]
  activeServerIndex: number
  syncMode: 'realtime' | 'batch'
  batchInterval: number
  enabledPlatforms: Platform[]
  isCollecting: boolean
}

export interface PlatformStats {
  platform: Platform
  collected: number
  pendingSync: number
}

export type ExtensionStatus = 'active' | 'paused' | 'error'

export const DEFAULT_CONFIG: ExtensionConfig = {
  servers: [
    { url: 'http://localhost:9531', token: '', name: '本地服务', isDefault: true },
  ],
  activeServerIndex: 0,
  syncMode: 'realtime',
  batchInterval: 5,
  enabledPlatforms: [Platform.ChatGPT, Platform.Gemini, Platform.Tongyi, Platform.Doubao],
  isCollecting: true,
}

// URL patterns for each platform to detect if current tab is an AI chat page
export const PLATFORM_URL_PATTERNS: Record<Platform, string[]> = {
  [Platform.ChatGPT]: ['chat.openai.com', 'chatgpt.com'],
  [Platform.Gemini]: ['gemini.google.com'],
  [Platform.Tongyi]: ['tongyi.aliyun.com', 'qianwen.aliyun.com'],
  [Platform.Doubao]: ['doubao.com'],
}
