export type Platform = 'chatgpt' | 'gemini' | 'tongyi' | 'doubao' | 'deepseek'

export interface Conversation {
  id: number
  platform: Platform
  conversation_id: string
  title: string
  message_count: number
  created_at: string
  updated_at: string
  synced_at: string
  last_read_at?: string | null
  has_unread?: boolean
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
  avg_messages_per_conv: number
  unread_count: number
  platform_msg_distribution: Record<string, number>
}

export interface TimelineSeries {
  platform: string
  data: number[]
}

export interface TimelineResponse {
  granularity: string
  metric: string
  dates: string[]
  series: TimelineSeries[]
}

export interface HeatmapCell {
  weekday: number
  hour: number
  count: number
}

export interface ActivityStats {
  by_hour: number[]
  by_weekday: number[]
  heatmap: HeatmapCell[]
}

export interface InsightsStats {
  user_messages: number
  assistant_messages: number
  user_chars: number
  assistant_chars: number
  avg_user_chars: number
  avg_assistant_chars: number
  platform_avg_reply_length: Record<string, number>
}

export interface TokenPair {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
}
