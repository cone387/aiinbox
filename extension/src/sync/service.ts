import { db } from '../storage/db'
import { collector } from '../storage/collector'
import { SyncStatus, ExtensionConfig } from '../types'

interface SyncConfig {
  serverUrl: string
  authToken: string
  mode: 'realtime' | 'batch'
  batchInterval: number // minutes
  maxRetries: number
}

export class SyncService {
  private config: SyncConfig | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false

  start(config: SyncConfig): void {
    this.config = config
    this.running = true

    if (config.mode === 'batch') {
      this.timer = setInterval(
        () => this.syncPending(),
        config.batchInterval * 60 * 1000
      )
    }

    // Initial sync
    this.syncPending()
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * Trigger immediate sync (used in realtime mode).
   */
  async triggerSync(): Promise<void> {
    if (!this.running || !this.config) return
    if (this.config.mode === 'realtime') {
      // Delay 5s to batch nearby messages
      setTimeout(() => this.syncPending(), 5000)
    }
  }

  /**
   * Sync all pending conversations to the remote server.
   */
  async syncPending(): Promise<void> {
    if (!this.config) return

    const pending = await collector.getPendingSync(50)
    if (pending.length === 0) return

    const conversationIds = pending.map((c) => c.conversationId)
    await collector.updateSyncStatus(conversationIds, 'syncing')

    // Build batch payload
    const payload = await Promise.all(
      pending.map(async (conv) => {
        const messages = await collector.getMessages(conv.conversationId)
        return {
          platform: conv.platform,
          conversation_id: conv.conversationId,
          title: conv.title,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
            is_complete: m.isComplete,
          })),
          created_at: conv.createdAt,
          updated_at: conv.updatedAt,
        }
      })
    )

    try {
      const response = await fetch(`${this.config.serverUrl}/api/v1/conversations/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.authToken}`,
        },
        body: JSON.stringify({ conversations: payload }),
      })

      if (response.status === 401) {
        // Auth failed - stop syncing
        await collector.updateSyncStatus(conversationIds, 'failed')
        this.stop()
        chrome.runtime.sendMessage({ type: 'AUTH_ERROR' })
        return
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const result = await response.json()

      // Mark successful ones as synced
      const syncedIds = result.results
        ?.filter((r: { action: string }) => r.action !== 'failed')
        .map((r: { conversation_id: string }) => r.conversation_id) || conversationIds

      await collector.updateSyncStatus(syncedIds, 'synced')

      // Mark failed ones
      const failedIds = result.errors?.map((e: { conversation_id: string }) => e.conversation_id) || []
      if (failedIds.length > 0) {
        await this.handleRetry(failedIds)
      }

      // Clean sync queue
      await db.syncQueue.where('conversationId').anyOf(syncedIds).delete()
    } catch (err) {
      // Network error - retry with backoff
      await this.handleRetry(conversationIds)
    }
  }

  private async handleRetry(conversationIds: string[]): Promise<void> {
    const maxRetries = this.config?.maxRetries || 5

    for (const convId of conversationIds) {
      const queueItem = await db.syncQueue.where('conversationId').equals(convId).first()
      if (!queueItem) continue

      const retryCount = queueItem.retryCount + 1
      if (retryCount >= maxRetries) {
        await collector.updateSyncStatus([convId], 'failed')
        await db.syncQueue.update(queueItem.id!, { status: 'failed', retryCount })
      } else {
        // Exponential backoff: 1min, 2min, 4min, 8min, 16min (capped at 30min)
        const delayMs = Math.min(60000 * Math.pow(2, retryCount - 1), 30 * 60000)
        const nextRetry = new Date(Date.now() + delayMs).toISOString()

        await collector.updateSyncStatus([convId], 'pending')
        await db.syncQueue.update(queueItem.id!, {
          status: 'pending',
          retryCount,
          nextRetryAt: nextRetry,
          lastError: 'Network error or server unavailable',
        })
      }
    }
  }
}

export const syncService = new SyncService()
