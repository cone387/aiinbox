import { Platform, UnifiedMessage } from '../types'

const DB_NAME = 'aiinbox'
const DB_VERSION = 1
const STORE_NAME = 'conversations'

export interface CachedConversation {
  id: string
  platform: Platform
  conversationId: string
  title: string
  messages: UnifiedMessage[]
  createdAt: string
  updatedAt: string
  captureMode: 'turn' | 'history'
  syncStatus: 'pending' | 'synced' | 'failed'
  syncAttempts: number
  lastSyncError?: string
  cachedAt: string
  syncedAt?: string
}

export interface CacheStats {
  total: number
  pending: number
  synced: number
  failed: number
}

export type PlatformStats = Record<string, CacheStats>

let dbInstance: IDBDatabase | null = null

export function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance)

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('platform', 'platform', { unique: false })
        store.createIndex('conversationId', 'conversationId', { unique: false })
        store.createIndex('syncStatus', 'syncStatus', { unique: false })
        store.createIndex('platformConvId', ['platform', 'conversationId'], { unique: false })
      }
    }

    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result
      dbInstance.onclose = () => { dbInstance = null }
      resolve(dbInstance)
    }

    request.onerror = () => reject(request.error)
  })
}

export async function saveConversation(conv: CachedConversation): Promise<void> {
  const db = await openDB()

  // Check for existing entry with same platform + conversationId
  const existing = await getByPlatformConvId(conv.platform, conv.conversationId)

  if (existing) {
    // Merge: keep existing messages, add new ones by timestamp dedup
    const existingTs = new Set(existing.messages.map(m => m.timestamp))
    const newMessages = conv.messages.filter(m => !existingTs.has(m.timestamp))
    existing.messages = [...existing.messages, ...newMessages]
    existing.title = conv.title || existing.title
    existing.updatedAt = conv.updatedAt > existing.updatedAt ? conv.updatedAt : existing.updatedAt
    existing.captureMode = conv.captureMode
    if (newMessages.length > 0 || existing.syncStatus === 'failed') {
      existing.syncStatus = 'pending'
      existing.syncAttempts = 0
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(existing)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).add(conv)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function getByPlatformConvId(platform: Platform, conversationId: string): Promise<CachedConversation | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const index = tx.objectStore(STORE_NAME).index('platformConvId')
    const request = index.get([platform, conversationId])
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error)
  })
}

export async function getPending(): Promise<CachedConversation[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const index = tx.objectStore(STORE_NAME).index('syncStatus')
    const results: CachedConversation[] = []

    const req1 = index.openCursor(IDBKeyRange.only('pending'))
    req1.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        results.push(cursor.value)
        cursor.continue()
      } else {
        // Also get failed with attempts < 5
        const req2 = index.openCursor(IDBKeyRange.only('failed'))
        req2.onsuccess = (event2) => {
          const cursor2 = (event2.target as IDBRequest<IDBCursorWithValue>).result
          if (cursor2) {
            if (cursor2.value.syncAttempts < 5) {
              results.push(cursor2.value)
            }
            cursor2.continue()
          } else {
            resolve(results)
          }
        }
        req2.onerror = () => reject(req2.error)
      }
    }
    req1.onerror = () => reject(req1.error)
  })
}

export async function markSynced(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(id)
    request.onsuccess = () => {
      const conv = request.result
      if (conv) {
        conv.syncStatus = 'synced'
        conv.syncedAt = new Date().toISOString()
        store.put(conv)
      }
      tx.oncomplete = () => resolve()
    }
    tx.onerror = () => reject(tx.error)
  })
}

export async function markFailed(id: string, error: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(id)
    request.onsuccess = () => {
      const conv = request.result
      if (conv) {
        conv.syncStatus = 'failed'
        conv.syncAttempts = (conv.syncAttempts || 0) + 1
        conv.lastSyncError = error
        store.put(conv)
      }
      tx.oncomplete = () => resolve()
    }
    tx.onerror = () => reject(tx.error)
  })
}

export async function resetFailedAttempts(): Promise<number> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('syncStatus')
    let resetCount = 0

    const request = index.openCursor(IDBKeyRange.only('failed'))
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        const conv = cursor.value
        conv.syncAttempts = 0
        conv.syncStatus = 'pending'
        store.put(conv)
        resetCount++
        cursor.continue()
      }
    }
    tx.oncomplete = () => resolve(resetCount)
    tx.onerror = () => reject(tx.error)
  })
}

export async function getAllConversations(): Promise<CachedConversation[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearSynced(): Promise<number> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('syncStatus')
    let deleted = 0

    const request = index.openCursor(IDBKeyRange.only('synced'))
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        store.delete(cursor.primaryKey)
        deleted++
        cursor.continue()
      }
    }
    tx.oncomplete = () => resolve(deleted)
    tx.onerror = () => reject(tx.error)
  })
}

export async function getStats(): Promise<CacheStats> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('syncStatus')
    const stats: CacheStats = { total: 0, pending: 0, synced: 0, failed: 0 }

    const countReq = store.count()
    countReq.onsuccess = () => { stats.total = countReq.result }

    const pendingReq = index.count(IDBKeyRange.only('pending'))
    pendingReq.onsuccess = () => { stats.pending = pendingReq.result }

    const syncedReq = index.count(IDBKeyRange.only('synced'))
    syncedReq.onsuccess = () => { stats.synced = syncedReq.result }

    const failedReq = index.count(IDBKeyRange.only('failed'))
    failedReq.onsuccess = () => { stats.failed = failedReq.result }

    tx.oncomplete = () => resolve(stats)
    tx.onerror = () => reject(tx.error)
  })
}

export async function getStatsByPlatform(): Promise<PlatformStats> {
  const conversations = await getAllConversations()
  const byPlatform: PlatformStats = {}
  for (const conv of conversations) {
    const s = byPlatform[conv.platform] || (byPlatform[conv.platform] = { total: 0, pending: 0, synced: 0, failed: 0 })
    s.total++
    if (conv.syncStatus === 'pending') s.pending++
    else if (conv.syncStatus === 'synced') s.synced++
    else if (conv.syncStatus === 'failed') s.failed++
  }
  return byPlatform
}
