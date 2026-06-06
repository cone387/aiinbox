// Use string literal union instead of enum to avoid bundling issues
export type Platform = 'chatgpt' | 'gemini' | 'tongyi' | 'doubao'

export const PLATFORMS: Platform[] = ['chatgpt', 'gemini', 'tongyi', 'doubao']

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
  enabledPlatforms: Platform[]
  isCollecting: boolean
  // Pure offline: capture to local IndexedDB only, never contact a server.
  offlineMode: boolean
}

export type ExtensionStatus = 'active' | 'paused' | 'error'

// Official hosted service. Empty until the official deployment is live; once set,
// fresh installs connect here by default. Self-hosting and local detection both
// keep working regardless of this value.
export const OFFICIAL_SERVICE_URL = ''

// Conventional address of a self-hosted server running on the user's machine.
// The popup probes this and offers a one-click connect when it's reachable.
export const LOCAL_SERVICE_URL = 'http://localhost:9531'

export const DEFAULT_CONFIG: ExtensionConfig = {
  servers: [
    { url: OFFICIAL_SERVICE_URL, token: '', name: '官方服务', isDefault: true },
  ],
  activeServerIndex: 0,
  enabledPlatforms: ['chatgpt', 'gemini', 'tongyi', 'doubao'],
  isCollecting: true,
  offlineMode: false,
}
