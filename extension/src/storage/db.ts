import Dexie, { Table } from 'dexie'
import { Platform, SyncStatus } from '../types'

export interface LocalConversation {
  id?: number
  conversationId: string
  platform: Platform
  title: string
  messageCount: number
  createdAt: string
  updatedAt: string
  syncStatus: SyncStatus
  lastSyncAt?: string
  rawData?: string
}

export interface LocalMessage {
  id?: number
  conversationId: string
  role: string
  content: string
  timestamp: string
  isComplete: boolean
}

export interface SyncQueueItem {
  id?: number
  conversationId: string
  status: 'pending' | 'syncing' | 'failed'
  retryCount: number
  nextRetryAt?: string
  lastError?: string
  createdAt: string
}

class AIChatDB extends Dexie {
  conversations!: Table<LocalConversation>
  messages!: Table<LocalMessage>
  syncQueue!: Table<SyncQueueItem>

  constructor() {
    super('AIChatCollector')
    this.version(1).stores({
      conversations:
        '++id, conversationId, platform, createdAt, updatedAt, syncStatus, [platform+createdAt]',
      messages: '++id, conversationId, role, timestamp, [conversationId+timestamp]',
      syncQueue: '++id, conversationId, status, createdAt, nextRetryAt',
    })
  }
}

export const db = new AIChatDB()
