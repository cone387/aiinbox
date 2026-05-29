import { db, LocalConversation, LocalMessage } from './db'
import { Platform, SyncStatus, UnifiedConversation } from '../types'

export interface StorageStats {
  totalConversations: number
  pendingSync: number
  byPlatform: Record<string, number>
}

export class Collector {
  /**
   * Save a conversation to local storage.
   * Handles deduplication by conversationId.
   */
  async save(conversation: UnifiedConversation): Promise<void> {
    const existing = await db.conversations
      .where('conversationId')
      .equals(conversation.conversationId)
      .first()

    if (existing) {
      // Merge: keep newer data
      if (conversation.updatedAt > existing.updatedAt) {
        await db.conversations.update(existing.id!, {
          title: conversation.title,
          messageCount: conversation.messages.length,
          updatedAt: conversation.updatedAt,
          syncStatus: 'pending',
        })

        // Replace messages
        await db.messages.where('conversationId').equals(conversation.conversationId).delete()
        await this.saveMessages(conversation)
      }
    } else {
      // Create new
      await db.conversations.add({
        conversationId: conversation.conversationId,
        platform: conversation.platform,
        title: conversation.title,
        messageCount: conversation.messages.length,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        syncStatus: 'pending',
      })
      await this.saveMessages(conversation)
    }

    // Add to sync queue
    await this.addToSyncQueue(conversation.conversationId)
  }

  /**
   * Save a raw response that failed to parse.
   */
  async saveRaw(platform: Platform, rawData: string): Promise<void> {
    // Limit to 1MB
    const truncated = rawData.length > 1_000_000 ? rawData.slice(0, 1_000_000) : rawData
    await db.conversations.add({
      conversationId: `raw_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      platform,
      title: '[Parse Failed]',
      messageCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      syncStatus: 'failed',
      rawData: truncated,
    })
  }

  /**
   * Query conversations with filters.
   */
  async query(options: {
    platform?: Platform[]
    startTime?: string
    endTime?: string
    syncStatus?: SyncStatus
    limit?: number
    offset?: number
  }): Promise<LocalConversation[]> {
    let collection = db.conversations.orderBy('createdAt').reverse()

    const results = await collection.toArray()

    let filtered = results
    if (options.platform?.length) {
      filtered = filtered.filter((c) => options.platform!.includes(c.platform))
    }
    if (options.startTime) {
      filtered = filtered.filter((c) => c.createdAt >= options.startTime!)
    }
    if (options.endTime) {
      filtered = filtered.filter((c) => c.createdAt <= options.endTime!)
    }
    if (options.syncStatus) {
      filtered = filtered.filter((c) => c.syncStatus === options.syncStatus)
    }

    const offset = options.offset || 0
    const limit = Math.min(options.limit || 100, 100)
    return filtered.slice(offset, offset + limit)
  }

  /**
   * Get conversations pending sync.
   */
  async getPendingSync(limit = 50): Promise<LocalConversation[]> {
    return db.conversations
      .where('syncStatus')
      .equals('pending')
      .limit(limit)
      .toArray()
  }

  /**
   * Update sync status for conversations.
   */
  async updateSyncStatus(conversationIds: string[], status: SyncStatus): Promise<void> {
    await db.conversations
      .where('conversationId')
      .anyOf(conversationIds)
      .modify({ syncStatus: status, lastSyncAt: new Date().toISOString() })
  }

  /**
   * Get messages for a conversation.
   */
  async getMessages(conversationId: string): Promise<LocalMessage[]> {
    return db.messages
      .where('conversationId')
      .equals(conversationId)
      .sortBy('timestamp')
  }

  /**
   * Get storage statistics.
   */
  async getStats(): Promise<StorageStats> {
    const total = await db.conversations.count()
    const pending = await db.conversations.where('syncStatus').equals('pending').count()

    const all = await db.conversations.toArray()
    const byPlatform: Record<string, number> = {}
    for (const conv of all) {
      byPlatform[conv.platform] = (byPlatform[conv.platform] || 0) + 1
    }

    return { totalConversations: total, pendingSync: pending, byPlatform }
  }

  /**
   * Clean synced conversations older than the given date.
   */
  async cleanSynced(before: string): Promise<number> {
    const toDelete = await db.conversations
      .where('syncStatus')
      .equals('synced')
      .filter((c) => c.updatedAt < before)
      .toArray()

    const ids = toDelete.map((c) => c.conversationId)
    await db.messages.where('conversationId').anyOf(ids).delete()
    const count = await db.conversations
      .where('conversationId')
      .anyOf(ids)
      .delete()

    return count
  }

  private async saveMessages(conversation: UnifiedConversation): Promise<void> {
    const messages: LocalMessage[] = conversation.messages.map((m) => ({
      conversationId: conversation.conversationId,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      isComplete: m.isComplete,
    }))
    await db.messages.bulkAdd(messages)
  }

  private async addToSyncQueue(conversationId: string): Promise<void> {
    const existing = await db.syncQueue
      .where('conversationId')
      .equals(conversationId)
      .first()

    if (!existing) {
      await db.syncQueue.add({
        conversationId,
        status: 'pending',
        retryCount: 0,
        createdAt: new Date().toISOString(),
      })
    } else if (existing.status === 'failed') {
      await db.syncQueue.update(existing.id!, {
        status: 'pending',
        retryCount: 0,
      })
    }
  }
}

export const collector = new Collector()
