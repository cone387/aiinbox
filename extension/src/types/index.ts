// Use string literal union instead of enum to avoid bundling issues
export type Platform = 'chatgpt' | 'gemini' | 'tongyi' | 'doubao'

export const PLATFORMS: Platform[] = ['chatgpt', 'gemini', 'tongyi', 'doubao']

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed'

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
  enabledPlatforms: ['chatgpt', 'gemini', 'tongyi', 'doubao'],
  isCollecting: true,
}
