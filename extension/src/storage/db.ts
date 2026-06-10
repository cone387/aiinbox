import { Platform, UnifiedMessage } from '../types'

const DB_NAME = 'aiinbox'
const DB_VERSION = 1
const STORE_NAME = 'conversations'

export interface ServerSyncStatus {
  status: 'pending' | 'synced' | 'failed'
  attempts: number
  error?: string
  syncedAt?: string
}

export interface CachedConversation {
  id: string
  platform: Platform
  conversationId: string
  title: string
  messages: UnifiedMessage[]
  createdAt: string
  updatedAt: string
  captureMode: 'turn' | 'history'
  cachedAt: string
  // Per-server sync tracking: one dict per server, each with its own status
  syncServers: Record<string, ServerSyncStatus>
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

/**
 * Migrate existing conversations to per-server sync tracking.
 * Only the activeServerUrl inherits the legacy syncStatus.
 * All other servers start as 'pending' so they sync fresh.
 */
export async function migrateSyncServers(serverUrls: string[], activeServerUrl: string): Promise<number> {
  if (serverUrls.length === 0) return 0
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    let migrated = 0

    const request = store.openCursor()
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        const conv = cursor.value
        if (!conv.syncServers) {
          // One-time migration: read legacy fields from raw DB record
          const raw = conv as any
          conv.syncServers = {}
          for (const url of serverUrls) {
            if (url === activeServerUrl) {
              conv.syncServers[url] = {
                status: raw.syncStatus || 'pending',
                attempts: raw.syncAttempts || 0,
                error: raw.lastSyncError,
                syncedAt: raw.syncedAt,
              }
            } else {
              conv.syncServers[url] = { status: 'pending', attempts: 0 }
            }
          }
          store.put(conv)
          migrated++
        }
        cursor.continue()
      }
    }
    tx.oncomplete = () => resolve(migrated)
    tx.onerror = () => reject(tx.error)
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
    if (newMessages.length > 0) {
      // New messages detected: mark ALL servers as pending (need to re-sync)
      for (const url of Object.keys(existing.syncServers)) {
        existing.syncServers[url] = { status: 'pending', attempts: 0 }
      }
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(existing)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  // Ensure syncServers is initialized
  if (!conv.syncServers) {
    conv.syncServers = {}
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

/** Get the sync status for a specific server.
 *  If no entry exists for this server, treat as 'pending'. */
function getServerSyncStatus(conv: CachedConversation, serverUrl: string): ServerSyncStatus {
  return conv.syncServers[serverUrl] || { status: 'pending', attempts: 0 }
}

/**
 * Get conversations pending sync for a specific server.
 * Includes: status='pending' or status='failed' with attempts < 5.
 */
export async function getPending(serverUrl: string): Promise<CachedConversation[]> {
  const all = await getAllConversations()
  return all.filter(conv => {
    const s = getServerSyncStatus(conv, serverUrl)
    return s.status === 'pending' || (s.status === 'failed' && s.attempts < 5)
  })
}

/** Mark a conversation as synced for a specific server */
export async function markSynced(id: string, serverUrl: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(id)
    request.onsuccess = () => {
      const conv = request.result
      if (conv) {
        if (!conv.syncServers) conv.syncServers = {}
        conv.syncServers[serverUrl] = {
          status: 'synced',
          attempts: 0,
          syncedAt: new Date().toISOString(),
        }
        store.put(conv)
      }
      tx.oncomplete = () => resolve()
    }
    tx.onerror = () => reject(tx.error)
  })
}

/** Mark a conversation as failed for a specific server */
export async function markFailed(id: string, serverUrl: string, error: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(id)
    request.onsuccess = () => {
      const conv = request.result
      if (conv) {
        if (!conv.syncServers) conv.syncServers = {}
        const current = conv.syncServers[serverUrl]
        conv.syncServers[serverUrl] = {
          status: 'failed',
          attempts: (current?.attempts || 0) + 1,
          error,
        }
        store.put(conv)
      }
      tx.oncomplete = () => resolve()
    }
    tx.onerror = () => reject(tx.error)
  })
}

/** Reset failed attempts for a specific server */
export async function resetFailedAttempts(serverUrl: string): Promise<number> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    let resetCount = 0

    const request = store.openCursor()
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        const conv = cursor.value
        if (conv.syncServers?.[serverUrl]?.status === 'failed') {
          conv.syncServers[serverUrl] = { status: 'pending', attempts: 0 }
          store.put(conv)
          resetCount++
        } else if (!conv.syncServers?.[serverUrl]) {
          if (!conv.syncServers) conv.syncServers = {}
          conv.syncServers[serverUrl] = { status: 'pending', attempts: 0 }
          store.put(conv)
        }
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

/**
 * Clear conversations synced to a specific server.
 * Removes the conversation entirely if it has no other servers.
 */
export async function clearSynced(serverUrl: string): Promise<number> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    let deleted = 0

    const request = store.openCursor()
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        const conv = cursor.value
        const ss = conv.syncServers?.[serverUrl]
        if (ss?.status === 'synced') {
          delete conv.syncServers[serverUrl]
          if (Object.keys(conv.syncServers).length === 0) {
            store.delete(cursor.primaryKey)
          } else {
            store.put(conv)
          }
          deleted++
        }
        cursor.continue()
      }
    }
    tx.oncomplete = () => resolve(deleted)
    tx.onerror = () => reject(tx.error)
  })
}

/** Derive a single overall status from a conversation's syncServers map.
 *  Used when no specific serverUrl is requested (global stats). */
function deriveOverallStatus(conv: CachedConversation): 'pending' | 'synced' | 'failed' {
  const entries = Object.values(conv.syncServers || {})
  if (entries.length === 0) return 'pending'
  if (entries.some(e => e.status === 'synced')) return 'synced'
  if (entries.some(e => e.status === 'failed')) return 'failed'
  return 'pending'
}

/** Get stats for a specific server, or global stats across all servers */
export async function getStats(serverUrl?: string): Promise<CacheStats> {
  const conversations = await getAllConversations()
  const stats: CacheStats = { total: conversations.length, pending: 0, synced: 0, failed: 0 }

  for (const conv of conversations) {
    if (serverUrl) {
      const s = getServerSyncStatus(conv, serverUrl)
      if (s.status === 'pending') stats.pending++
      else if (s.status === 'synced') stats.synced++
      else if (s.status === 'failed') stats.failed++
    } else {
      const status = deriveOverallStatus(conv)
      if (status === 'pending') stats.pending++
      else if (status === 'synced') stats.synced++
      else if (status === 'failed') stats.failed++
    }
  }
  return stats
}

/** Get stats by platform, optionally filtered by server */
export async function getStatsByPlatform(serverUrl?: string): Promise<PlatformStats> {
  const conversations = await getAllConversations()
  const byPlatform: PlatformStats = {}
  for (const conv of conversations) {
    const s = byPlatform[conv.platform] || (byPlatform[conv.platform] = { total: 0, pending: 0, synced: 0, failed: 0 })
    s.total++
    if (serverUrl) {
      const ss = getServerSyncStatus(conv, serverUrl)
      if (ss.status === 'pending') s.pending++
      else if (ss.status === 'synced') s.synced++
      else if (ss.status === 'failed') s.failed++
    } else {
      const status = deriveOverallStatus(conv)
      if (status === 'pending') s.pending++
      else if (status === 'synced') s.synced++
      else if (status === 'failed') s.failed++
    }
  }
  return byPlatform
}
