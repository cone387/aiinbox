export type Platform = 'chatgpt' | 'gemini' | 'tongyi' | 'doubao'

export interface Conversation {
  id: number
  platform: Platform
  conversation_id: string
  title: string
  message_count: number
  created_at: string
  updated_at: string
}

export interface Message {
  id: number
  role: 'user' | 'assistant' | 'system' | 'unknown'
  content: string
  timestamp: string
  is_complete: boolean
}

export interface ConversationDetail extends Conversation {
  messages: Message[]
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface SearchResultItem {
  conversation_id: number
  platform: Platform
  title: string
  message_id: number
  role: string
  context: string
  highlight: string
  timestamp: string
  created_at: string
  relevance_score: number
}

export interface StatsOverview {
  total_conversations: number
  total_messages: number
  this_week_new: number
  platform_distribution: Record<string, number>
}

export interface TimelinePoint {
  date: string
  count: number
}

export interface TokenPair {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
}
