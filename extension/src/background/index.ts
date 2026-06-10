import { getAdapterByPlatform } from '../adapters'
import { ExtensionConfig, Platform, DEFAULT_CONFIG, LOCAL_SERVICE_URL } from '../types'
import { saveConversation, getPending, markSynced, markFailed, getStats, getStatsByPlatform, clearSynced, resetFailedAttempts, migrateSyncServers, getAllConversations, CachedConversation } from '../storage/db'
import { exportAsJSON, exportAsMarkdown } from '../storage/export'

// Platform URL detection patterns
const PLATFORM_PATTERNS: Record<string, string[]> = {
  chatgpt: ['chat.openai.com', 'chatgpt.com'],
  gemini: ['gemini.google.com'],
  tongyi: ['tongyi.aliyun.com', 'qianwen.aliyun.com', 'www.qianwen.com', 'qianwen.com'],
  doubao: ['doubao.com'],
  deepseek: ['chat.deepseek.com'],
}

let config: ExtensionConfig = { ...DEFAULT_CONFIG }
let isCollecting = false
let cachedHealth = { server: true, auth: true }
let lastSyncTime: string | null = null
let initPromise: Promise<void>

type SyncPhase = 'idle' | 'listing' | 'fetching' | 'done' | 'error'
let historySync: { running: boolean; platform: Platform | null; phase: SyncPhase; done: number; total: number; failed: number; error: string | null } = {
  running: false, platform: null, phase: 'idle', done: 0, total: 0, failed: 0, error: null,
}

// Watchdog: if a running sync goes silent (page closed/navigated, or a dropped
// plan reply) for this long, mark it errored so the UI recovers instead of
// staying stuck in 'running'. Re-armed on every sync message.
let syncWatchdog: ReturnType<typeof setTimeout> | null = null
const SYNC_WATCHDOG_MS = 120000

function armSyncWatchdog(): void {
  if (syncWatchdog) clearTimeout(syncWatchdog)
  syncWatchdog = setTimeout(() => {
    syncWatchdog = null
    if (historySync.running) {
      console.warn('[AI Inbox] History sync watchdog fired — no progress for 120s, resetting')
      historySync = { ...historySync, running: false, phase: 'error', error: 'timeout' }
      revertBadge()
    }
  }, SYNC_WATCHDOG_MS)
}

function clearSyncWatchdog(): void {
  if (syncWatchdog) { clearTimeout(syncWatchdog); syncWatchdog = null }
}

// Initialize
chrome.runtime.onInstalled.addListener(() => {
  console.log('[AI Inbox] Extension installed')
  initPromise = loadConfig()
})

chrome.runtime.onStartup.addListener(() => {
  initPromise = loadConfig()
})

// Initialize immediately and track promise so message handler can await it
initPromise = loadConfig()

async function loadConfig(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get('config')
    if (stored.config) {
      const cfg = stored.config as any
      // Migrate old config format
      if (!cfg.servers) {
        config = {
          ...DEFAULT_CONFIG,
          servers: [{
            url: cfg.serverUrl || 'http://localhost:9531',
            token: cfg.authToken || '',
            name: 'Local',
            isDefault: true,
          }],
          enabledPlatforms: cfg.enabledPlatforms || DEFAULT_CONFIG.enabledPlatforms,
          isCollecting: cfg.isCollecting ?? true,
        }
        await chrome.storage.local.set({ config })
      } else {
        config = cfg as ExtensionConfig
        // Ensure new platforms are added to existing configs
        if (!config.enabledPlatforms?.includes('deepseek')) {
          config.enabledPlatforms = [...(config.enabledPlatforms || []), 'deepseek']
          await chrome.storage.local.set({ config })
        }
      }
    } else {
      await chrome.storage.local.set({ config: DEFAULT_CONFIG })
      config = { ...DEFAULT_CONFIG }
    }

    // Migrate per-server sync tracking for all known servers
    const knownUrls = (config.servers || []).map(s => s.url).filter(Boolean)
    const activeUrl = config.servers?.[config.activeServerIndex]?.url || ''
    if (knownUrls.length > 0 && activeUrl) {
      migrateSyncServers(knownUrls, activeUrl).catch(err => {
        console.error('[AI Inbox] Migration error:', err)
      })
    }

    const server = config.servers?.[config.activeServerIndex]
    const canCollect = config.offlineMode || !!(server?.url && server?.token)
    if (config.isCollecting && canCollect) {
      startCollecting()
    }

    // Server-dependent alarms only make sense when connected to a server.
    if (!config.offlineMode && server?.url && server?.token) {
      startHealthCheck()
      startSyncAlarm()
    }
  } catch (err) {
    console.error('[AI Inbox] Failed to load config:', err)
  }
}

function startHealthCheck(): void {
  chrome.alarms.clear('health-check')
  chrome.alarms.create('health-check', { periodInMinutes: 1 })
  const server = config.servers?.[config.activeServerIndex]
  if (server?.url && server?.token) {
    checkServerHealth(server.url, server.token)
  }
}

function startCollecting(): void {
  if (isCollecting) return

  const server = config.servers?.[config.activeServerIndex]
  // Offline mode captures to local storage only, so no server is required.
  if (!config.offlineMode && (!server?.url || !server?.token)) return

  isCollecting = true
  config.isCollecting = true
  chrome.storage.local.set({ config })
  updateIcon('active')
  console.log('[AI Inbox] Started collecting')
}

function stopCollecting(): void {
  isCollecting = false
  config.isCollecting = false
  chrome.storage.local.set({ config })
  updateIcon('paused')
  console.log('[AI Inbox] Stopped collecting')
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'health-check') {
    const server = config.servers?.[config.activeServerIndex]
    if (server?.url && server?.token) {
      checkServerHealth(server.url, server.token)
    }
  }
  if (alarm.name === 'sync-pending') {
    syncPendingConversations()
  }
})

async function checkServerHealth(url: string, token?: string): Promise<{ server: boolean; auth: boolean }> {
  let serverOk = false
  let authOk = false

  for (let attempt = 0; attempt < 2 && !serverOk; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 300))
    try {
      const resp = await fetch(`${url}/health`, { method: 'GET', signal: AbortSignal.timeout(5000) })
      if (resp.ok) {
        const data = await resp.json()
        serverOk = data.status === 'ok'
      }
    } catch {}
  }

  if (serverOk && token) {
    try {
      const resp = await fetch(`${url}/health/auth`, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + token },
        signal: AbortSignal.timeout(5000),
      })
      authOk = resp.ok
    } catch {}
  }

  cachedHealth = { server: serverOk, auth: authOk }

  // Trigger sync when server is healthy
  if (serverOk && authOk) {
    syncPendingConversations()
  }

  return cachedHealth
}

function detectPlatformFromUrl(url: string): Platform | null {
  if (!url) return null
  for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
    if (patterns.some((p) => url.includes(p))) {
      return platform as Platform
    }
  }
  return null
}

// Normalize a conversation update time to epoch ms. ChatGPT's list API returns
// update_time as either an ISO string or a unix-seconds float, depending on endpoint.
function normalizeTime(t: string | number | undefined): number {
  if (t == null) return 0
  if (typeof t === 'number') return t < 1e12 ? t * 1000 : t
  const parsed = Date.parse(t)
  if (!isNaN(parsed)) return parsed
  const num = Number(t)
  return isNaN(num) ? 0 : (num < 1e12 ? num * 1000 : num)
}

// Logging
const logBuffer: Array<{ time: string; level: string; msg: string }> = []
const LOG_MAX = 200

function pushLog(level: string, ...args: any[]) {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
  logBuffer.push({ time: new Date().toISOString(), level, msg })
  if (logBuffer.length > LOG_MAX) logBuffer.shift()
}

// Wrap console methods
const origLog = console.log
const origWarn = console.warn
const origError = console.error

console.log = (...args: any[]) => { pushLog('INFO', ...args); origLog(...args) }
console.warn = (...args: any[]) => { pushLog('WARN', ...args); origWarn(...args) }
console.error = (...args: any[]) => { pushLog('ERROR', ...args); origError(...args) }

// Handle messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse)
  return true
})

async function handleMessage(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) {
  try {
    // Wait for config to load before processing any message
    if (initPromise) await initPromise

    switch (message.type) {
      case 'RESPONSE_COMPLETE': {
        const platform = message.platform as Platform
        const captureMode = message.captureMode || 'turn'
        if (!config.enabledPlatforms?.includes(platform)) { sendResponse({ ok: false }); return }
        // Turn captures require collecting mode; history captures (user-initiated) always work
        if (captureMode === 'turn' && !isCollecting) { sendResponse({ ok: false }); return }

        const adapter = getAdapterByPlatform(platform)
        if (!adapter) { sendResponse({ ok: false, error: 'no adapter for ' + platform }); return }

        const result = adapter.parseResponse({
          requestId: message.requestId || '',
          tabId: 0,
          platform,
          url: message.url || '',
          statusCode: 200,
          body: message.body || '',
          requestBody: message.requestBody || '',
          isComplete: message.isComplete ?? true,
          timestamp: new Date().toISOString(),
          captureMode,
          pageTitle: message.pageTitle || '',
        })

        if (result.success && result.conversation) {
          const conv = result.conversation
          const msgSummary = conv.messages.map(m => `${m.role}:${m.content.length}`).join(', ')
          console.log(`[AI Inbox] Parsed ${captureMode} from ${platform} (${conv.messages.length} messages [${msgSummary}], title: "${conv.title}", id: ${conv.conversationId})`)

          // Cache first — save to IndexedDB before attempting upload
          const cached: CachedConversation = {
            id: conv.id,
            platform: conv.platform,
            conversationId: conv.conversationId,
            title: conv.title,
            messages: conv.messages,
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
            captureMode: captureMode as 'turn' | 'history',
            syncStatus: 'pending',
            syncAttempts: 0,
            cachedAt: new Date().toISOString(),
            syncServers: {},
          }

          try {
            await saveConversation(cached)
            console.log(`[AI Inbox] Cached ${captureMode} from ${platform} (id: ${conv.conversationId})`)
          } catch (err) {
            console.error(`[AI Inbox] Cache write failed:`, err)
          }

          // Attempt immediate upload (offline mode keeps it local-only).
          if (!config.offlineMode) {
            await uploadConversation(cached)
          }
        } else if (message.body?.length > 100) {
          console.warn(`[AI Inbox] Parse failed for ${platform}: ${result.error}`)
        } else {
          console.log(`[AI Inbox] Skipped ${platform} response: ${result.error}`)
        }

        sendResponse({ ok: true })
        break
      }

      case 'STREAM_CHUNK': {
        sendResponse({ ok: true })
        break
      }

      case 'GET_STATUS': {
        let activePlatform: Platform | null = null
        try {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
          const currentUrl = tabs[0]?.url || ''
          activePlatform = detectPlatformFromUrl(currentUrl)
        } catch {}

        sendResponse({
          isCollecting,
          status: isCollecting ? 'active' : 'paused',
          activePlatform,
          config,
          health: cachedHealth,
        })
        break
      }

      case 'TOGGLE_COLLECTING': {
        if (isCollecting) {
          stopCollecting()
        } else {
          startCollecting()
        }
        sendResponse({ isCollecting })
        break
      }

      case 'TOGGLE_PLATFORM': {
        const platform = message.platform as Platform
        if (!config.enabledPlatforms) config.enabledPlatforms = []

        if (config.enabledPlatforms.includes(platform)) {
          config.enabledPlatforms = config.enabledPlatforms.filter((p) => p !== platform)
        } else {
          config.enabledPlatforms.push(platform)
        }
        await chrome.storage.local.set({ config })
        sendResponse({ enabledPlatforms: config.enabledPlatforms })
        break
      }

      case 'PROBE_LOCAL': {
        // Detect a self-hosted server on the user's machine so the popup can
        // offer to connect. Reachability only — auth happens on user confirm.
        let available = false
        try {
          const resp = await fetch(`${LOCAL_SERVICE_URL}/health`, { method: 'GET', signal: AbortSignal.timeout(2000) })
          available = resp.ok
        } catch {}
        const activeUrl = config.servers?.[config.activeServerIndex]?.url
        sendResponse({ available, localUrl: LOCAL_SERVICE_URL, alreadyActive: activeUrl === LOCAL_SERVICE_URL })
        break
      }

      case 'HEALTH_CHECK': {
        const url = message.url as string
        // Use token from message if provided, otherwise look up from config
        const token = message.token || config.servers?.find((s) => s.url === url)?.token || ''
        const result = await checkServerHealth(url, token)
        sendResponse(result)
        break
      }

      case 'START_AUTH': {
        const serverUrl = (message.url as string).replace(/\/$/, '')
        try {
          const redirectUri = chrome.identity.getRedirectURL()
          const stateNonce = Math.random().toString(36).slice(2)
          const authUrl = `${serverUrl}/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=${stateNonce}&app_name=${encodeURIComponent('AI Inbox \u63D2\u4EF6')}`

          const responseUrl = await chrome.identity.launchWebAuthFlow({
            url: authUrl,
            interactive: true,
          })

          if (!responseUrl) {
            sendResponse({ ok: false, error: 'no_response' })
            break
          }

          const respUrlObj = new URL(responseUrl)
          const code = respUrlObj.searchParams.get('code')
          const returnedState = respUrlObj.searchParams.get('state')
          const error = respUrlObj.searchParams.get('error')

          if (error) { sendResponse({ ok: false, error }); break }
          if (!code) { sendResponse({ ok: false, error: 'no_code' }); break }
          if (returnedState !== stateNonce) { sendResponse({ ok: false, error: 'state_mismatch' }); break }

          // Exchange code for token via POST
          const exchangeResp = await fetch(`${serverUrl}/api/v1/auth/exchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, state: stateNonce }),
          })

          if (!exchangeResp.ok) {
            const errText = await exchangeResp.text()
            sendResponse({ ok: false, error: 'exchange_failed: ' + errText })
            break
          }

          const exchangeData = await exchangeResp.json()
          const token = exchangeData.token

          if (!token) { sendResponse({ ok: false, error: 'no_token' }); break }

          // Save token to matching server config
          if (!config.servers) config.servers = []
          const idx = config.servers.findIndex((s) => s.url === serverUrl)
          if (idx >= 0) {
            config.servers[idx].token = token
            config.activeServerIndex = idx
          } else {
            config.servers.push({ url: serverUrl, token, name: serverUrl, isDefault: config.servers.length === 0 })
            config.activeServerIndex = config.servers.length - 1
          }
          await chrome.storage.local.set({ config })

          // Immediately refresh health status with new token
          cachedHealth = { server: true, auth: true }
          checkServerHealth(serverUrl, token)
          startHealthCheck()

          if (config.isCollecting) {
            stopCollecting()
            startCollecting()
          }

          sendResponse({ ok: true, token })
        } catch (err) {
          sendResponse({ ok: false, error: String(err) })
        }
        break
      }

      case 'SAVE_CONFIG': {
        const prevServerUrls = (config.servers || []).map(s => s.url).filter(Boolean)
        const prevActiveUrl = config.servers?.[config.activeServerIndex]?.url || ''
        
        config = message.config as ExtensionConfig
        await chrome.storage.local.set({ config })
        
        const server = config.servers?.[config.activeServerIndex]
        const canCollect = config.offlineMode || !!(server?.url && server?.token)
        // Reconcile the in-memory collecting flag against the new config.
        if (config.isCollecting && canCollect) {
          if (!isCollecting) { isCollecting = true; updateIcon('active') }
        } else if (isCollecting) {
          isCollecting = false
          updateIcon('paused')
        }
        
        // Detect new servers and migrate their sync tracking
        const newServerUrls = (config.servers || []).map(s => s.url).filter(Boolean)
        const addedUrls = newServerUrls.filter(url => !prevServerUrls.includes(url))
        if (addedUrls.length > 0) {
          // For newly added servers, pass the OLD active server so legacy status
          // is only inherited by the old server; new servers start as 'pending'.
          console.log(`[AI Inbox] New servers added: ${addedUrls.join(', ')}`)
          migrateSyncServers(newServerUrls, prevActiveUrl).then(count => {
            if (count > 0) console.log(`[AI Inbox] Migrated ${count} conversations for new servers`)
          }).catch(err => console.error('[AI Inbox] Migration error:', err))
        }
        
        if (!config.offlineMode && server?.url && server?.token) {
          startHealthCheck()
          startSyncAlarm()
          // Immediately sync pending data after configuration (1s delay for health check)
          setTimeout(() => {
            syncPendingConversations().then(() => {
              console.log('[AI Inbox] Initial sync completed after config save')
            })
          }, 1000)
        }
        sendResponse({ ok: true })
        break
      }

      case 'CONFIG_UPDATED': {
        await loadConfig()
        sendResponse({ ok: true })
        break
      }

      case 'LOG': {
        // Content scripts forward logs here
        const src = sender.tab ? `tab:${sender.tab.id}` : 'popup'
        pushLog(message.level || 'INFO', `[${src}]`, message.msg)
        sendResponse({ ok: true })
        break
      }

      case 'GET_LOGS': {
        sendResponse({ logs: [...logBuffer] })
        break
      }

      case 'CLEAR_LOGS': {
        logBuffer.length = 0
        sendResponse({ ok: true })
        break
      }

      case 'GET_CACHE_STATS': {
        const serverUrl = message.serverUrl as string | undefined
        const stats = await getStats(serverUrl)
        const byPlatform = await getStatsByPlatform(serverUrl)
        sendResponse({ ...stats, byPlatform, lastSyncTime })
        break
      }

      case 'EXPORT_DATA': {
        const format = message.format === 'markdown' ? 'markdown' : 'json'
        const data = format === 'markdown'
          ? await exportAsMarkdown(message.filter)
          : await exportAsJSON(message.filter)
        sendResponse({ data, format })
        break
      }

      case 'RETRY_FAILED': {
        // Reset failed attempts for the specified server and retry
        const serverUrl = (message.serverUrl as string) || config.servers?.[config.activeServerIndex]?.url
        if (!serverUrl) {
          sendResponse({ ok: false, error: 'no_server_url' })
          break
        }
        resetFailedAttempts(serverUrl).then(count => {
          console.log(`[AI Inbox] Reset ${count} failed conversations to pending for ${serverUrl}`)
          syncPendingConversations().catch(err => {
            console.error('[AI Inbox] Sync error:', err)
          })
        }).catch(err => {
          console.error('[AI Inbox] Failed to reset attempts:', err)
        })
        sendResponse({ ok: true })
        break
      }

      case 'CANCEL_SYNC': {
        syncCancelled = true
        console.log('[AI Inbox] Sync cancellation requested')
        sendResponse({ ok: true })
        break
      }

      case 'CLEAR_SYNCED': {
        const clearServerUrl = (message.serverUrl as string) || config.servers?.[config.activeServerIndex]?.url || ''
        const deleted = await clearSynced(clearServerUrl)
        sendResponse({ ok: true, deleted })
        break
      }

      case 'SYNC_ALL_HISTORY': {
        const platform = message.platform as Platform
        if (!config.enabledPlatforms?.includes(platform)) {
          sendResponse({ ok: false, error: 'platform_disabled' })
          break
        }
        if (historySync.running) {
          sendResponse({ ok: false, error: 'already_running' })
          break
        }
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        const tab = tabs[0]
        if (!tab?.id || detectPlatformFromUrl(tab.url || '') !== platform) {
          sendResponse({ ok: false, error: 'not_on_platform' })
          break
        }
        historySync = { running: true, platform, phase: 'listing', done: 0, total: 0, failed: 0, error: null }
        updateSyncBadge()
        armSyncWatchdog()
        try {
          await chrome.tabs.sendMessage(tab.id, { type: 'SYNC_ALL_HISTORY', platform })
          sendResponse({ ok: true })
        } catch (err) {
          clearSyncWatchdog()
          historySync = { running: false, platform, phase: 'error', done: 0, total: 0, failed: 0, error: String(err) }
          revertBadge()
          sendResponse({ ok: false, error: String(err) })
        }
        break
      }

      case 'PLAN_HISTORY_SYNC': {
        const platform = message.platform as Platform
        const items: Array<{ id: string; updateTime?: string | number }> = message.items || []
        const all = await getAllConversations()
        const cachedUpdated = new Map<string, string>()
        for (const c of all) {
          if (c.platform === platform) cachedUpdated.set(c.conversationId, c.updatedAt)
        }
        const toFetch: string[] = []
        for (const it of items) {
          const local = cachedUpdated.get(it.id)
          if (!local) { toFetch.push(it.id); continue }
          const remoteMs = normalizeTime(it.updateTime)
          const localMs = Date.parse(local) || 0
          if (remoteMs > localMs) toFetch.push(it.id)
        }
        historySync.phase = 'fetching'
        historySync.total = toFetch.length
        historySync.done = 0
        armSyncWatchdog()
        console.log(`[AI Inbox] History sync plan: ${items.length} listed, ${toFetch.length} to fetch`)
        sendResponse({ toFetch })
        break
      }

      case 'SYNC_PROGRESS': {
        if (typeof message.done === 'number') historySync.done = message.done
        if (typeof message.total === 'number') historySync.total = message.total
        if (typeof message.failed === 'number') historySync.failed = message.failed
        if (message.phase) historySync.phase = message.phase as SyncPhase
        if (message.error) historySync.error = String(message.error)
        if (message.phase === 'done' || message.phase === 'error') {
          historySync.running = false
          clearSyncWatchdog()
          if (message.phase === 'done') {
            console.log(`[AI Inbox] History sync complete: ${historySync.done}/${historySync.total} (failed ${historySync.failed})`)
          } else {
            console.warn(`[AI Inbox] History sync error: ${historySync.error}`)
          }
          revertBadge()
        } else {
          updateSyncBadge()
          armSyncWatchdog()
        }
        sendResponse({ ok: true })
        break
      }

      case 'GET_SYNC_PROGRESS': {
        sendResponse(historySync)
        break
      }

      default:
        sendResponse({ ok: false, error: 'unknown message type' })
    }
  } catch (err) {
    console.error('[AI Inbox] Message handler error:', err)
    sendResponse({ ok: false, error: String(err) })
  }
}

function updateIcon(status: 'active' | 'paused' | 'error'): void {
  const colors: Record<string, string> = {
    active: '#22c55e',
    paused: '#9ca3af',
    error: '#ef4444',
  }
  chrome.action.setBadgeBackgroundColor({ color: colors[status] })
  chrome.action.setBadgeText({ text: status === 'active' ? '' : status === 'paused' ? 'P' : '!' })
}

// Show live history-sync status on the toolbar badge so the user doesn't have
// to open the popup. Listing → '...', fetching → percent, all on a blue badge.
function updateSyncBadge(): void {
  chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' })
  if (historySync.phase === 'listing') {
    chrome.action.setBadgeText({ text: '...' })
    chrome.action.setTitle({ title: 'AI Inbox — 正在列举对话…' })
  } else {
    const pct = historySync.total > 0 ? Math.round((historySync.done / historySync.total) * 100) : 0
    chrome.action.setBadgeText({ text: pct + '%' })
    chrome.action.setTitle({
      title: `AI Inbox — 同步中 ${historySync.done}/${historySync.total}` + (historySync.failed ? `（失败 ${historySync.failed}）` : ''),
    })
  }
}

// Restore the normal collecting/paused badge after a sync ends. If the sync had
// failures or errored, briefly flag it on the badge before reverting.
function revertBadge(): void {
  const finishedWithProblem = historySync.phase === 'error' || historySync.failed > 0
  if (finishedWithProblem) {
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' })
    chrome.action.setBadgeText({ text: '!' })
    chrome.action.setTitle({
      title: historySync.phase === 'error'
        ? `AI Inbox — 同步失败：${historySync.error || 'unknown'}`
        : `AI Inbox — 同步完成，${historySync.failed} 条失败`,
    })
    setTimeout(() => {
      chrome.action.setTitle({ title: 'AI Inbox' })
      updateIcon(isCollecting ? 'active' : 'paused')
    }, 6000)
  } else {
    chrome.action.setTitle({ title: 'AI Inbox' })
    updateIcon(isCollecting ? 'active' : 'paused')
  }
}

// Upload a cached conversation to the server
async function uploadConversation(conv: CachedConversation): Promise<void> {
  const server = config.servers?.[config.activeServerIndex]
  if (!server?.url || !server?.token) {
    await markFailed(conv.id, server?.url || '', 'no_server_configured')
    throw new Error('no_server_configured')
  }

  const payload = {
    platform: conv.platform,
    conversation_id: conv.conversationId,
    title: conv.title,
    messages: conv.messages.map(m => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    })),
    created_at: conv.createdAt,
    updated_at: conv.updatedAt,
  }

  // Check network status before upload
  if (!navigator.onLine) {
    const errorMsg = 'network_offline'
    await markFailed(conv.id, server.url, errorMsg)
    throw new Error(errorMsg)
  }

  try {
    // Dynamic timeout based on message count
    const timeout = Math.max(15000, conv.messages.length * 100)
    const resp = await fetch(`${server.url}/api/v1/conversations/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + server.token,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeout),
    })

    if (resp.ok) {
      await markSynced(conv.id, server.url)
      lastSyncTime = new Date().toISOString()
      console.log(`[AI Inbox] Uploaded ${conv.platform}/${conv.conversationId}`)
    } else {
      const text = await resp.text().catch(() => '')
      const errorMsg = `${resp.status} - ${text.slice(0, 100)}`
      await markFailed(conv.id, server.url, errorMsg)
      console.warn(`[AI Inbox] Upload failed ${resp.status}: ${text.slice(0, 100)}`)
      throw new Error(errorMsg)
    }
  } catch (err) {
    const errorMsg = String(err)
    await markFailed(conv.id, server.url, errorMsg)
    console.warn(`[AI Inbox] Upload error:`, err)
    throw err
  }
}

// Convert technical error to user-friendly message
function getUserFriendlyError(error: string): string {
  if (error.includes('429')) return '请求太频繁，系统已自动等待后重试'
  if (error.includes('timeout') || error.includes('TimeoutError')) return '连接超时，请检查网络或稍后重试'
  if (error.includes('Failed to fetch') || error.includes('NetworkError')) return '无法连接服务器，请检查网络'
  if (error.includes('network_offline')) return '网络已断开，请检查网络连接'
  if (error.includes('no_server_configured')) return '未配置服务器，请先在设置中配置'
  if (error.includes('401') || error.includes('Unauthorized')) return '授权已过期，请重新授权登录'
  if (error.includes('403') || error.includes('Forbidden')) return '权限不足，请检查授权'
  if (error.includes('500')) return '服务器内部错误，请稍后重试'
  if (error.includes('502') || error.includes('503') || error.includes('504')) return '服务器暂时不可用，请稍后重试'
  return error
}

// Wait for network to come back online
async function waitForNetwork(): Promise<boolean> {
  if (navigator.onLine) return true
  console.log('[AI Inbox] Network offline, waiting...')
  return new Promise<boolean>((resolve) => {
    const checkNetwork = () => {
      if (navigator.onLine || syncCancelled) {
        window.removeEventListener('online', checkNetwork)
        resolve(!syncCancelled)
      }
    }
    window.addEventListener('online', checkNetwork)
    const interval = setInterval(() => {
      if (navigator.onLine || syncCancelled) {
        clearInterval(interval)
        window.removeEventListener('online', checkNetwork)
        resolve(!syncCancelled)
      }
    }, 5000)
  })
}

// Sync all pending/failed conversations (concurrent: up to 3 at a time)
let syncCancelled = false
const SYNC_CONCURRENCY = 3
const SYNC_BATCH_DELAY = 500  // delay between batches in ms

async function syncPendingConversations(): Promise<void> {
  syncCancelled = false
  
  if (config.offlineMode) {
    console.log('[AI Inbox] Sync skipped: offline mode')
    return
  }
  const server = config.servers?.[config.activeServerIndex]
  if (!server?.url || !server?.token) {
    console.log('[AI Inbox] Sync skipped: no server configured')
    chrome.runtime.sendMessage({
      type: 'SYNC_COMPLETE',
      success: 0,
      failed: 0,
      errors: ['未配置服务器'],
    }).catch(() => {})
    return
  }
  if (!cachedHealth.server || !cachedHealth.auth) {
    console.log('[AI Inbox] Sync skipped: server not healthy')
    chrome.runtime.sendMessage({
      type: 'SYNC_COMPLETE',
      success: 0,
      failed: 0,
      errors: ['服务器未连接或授权失败'],
    }).catch(() => {})
    return
  }

  const pending = await getPending(server.url)
  if (pending.length === 0) {
    console.log('[AI Inbox] Sync skipped: no pending conversations')
    chrome.runtime.sendMessage({
      type: 'SYNC_COMPLETE',
      success: 0,
      failed: 0,
      errors: [],
    }).catch(() => {})
    return
  }

  console.log(`[AI Inbox] Syncing ${pending.length} pending conversations (concurrency: ${SYNC_CONCURRENCY})`)
  let successCount = 0
  let failCount = 0
  let processedCount = 0
  const errors: string[] = []
  
  // Broadcast sync start
  chrome.runtime.sendMessage({
    type: 'SYNC_PROGRESS',
    current: 0,
    total: pending.length,
    success: 0,
    failed: 0,
  }).catch(() => {})
  
  // Process in batches of SYNC_CONCURRENCY
  for (let batchStart = 0; batchStart < pending.length; batchStart += SYNC_CONCURRENCY) {
    // Check if sync was cancelled
    if (syncCancelled) {
      console.log('[AI Inbox] Sync cancelled by user')
      break
    }
    
    // Check network status
    if (!navigator.onLine) {
      const ok = await waitForNetwork()
      if (!ok || syncCancelled) {
        console.log('[AI Inbox] Sync cancelled while waiting for network')
        break
      }
      console.log('[AI Inbox] Network online, resuming sync...')
    }
    
    // Get current batch
    const batch = pending.slice(batchStart, batchStart + SYNC_CONCURRENCY)
    
    // Upload all conversations in this batch concurrently
    const results = await Promise.allSettled(
      batch.map(conv => uploadConversation(conv))
    )
    
    // Process results
    for (const result of results) {
      processedCount++
      if (result.status === 'fulfilled') {
        successCount++
      } else {
        failCount++
        const friendlyError = getUserFriendlyError(String(result.reason))
        errors.push(friendlyError)
        
        // If rate limited, add extra delay before next batch
        if (String(result.reason).includes('429')) {
          console.log('[AI Inbox] Rate limited, waiting 10s before next batch...')
          await new Promise(resolve => setTimeout(resolve, 10000))
        }
      }
    }
    
    // Broadcast progress
    chrome.runtime.sendMessage({
      type: 'SYNC_PROGRESS',
      current: processedCount,
      total: pending.length,
      success: successCount,
      failed: failCount,
    }).catch(() => {})
    
    // Small delay between batches
    if (batchStart + SYNC_CONCURRENCY < pending.length && !syncCancelled) {
      await new Promise(resolve => setTimeout(resolve, SYNC_BATCH_DELAY))
    }
  }
  
  if (syncCancelled) {
    errors.push('用户取消同步')
  }
  
  lastSyncTime = new Date().toISOString()
  console.log(`[AI Inbox] Sync completed: ${successCount} success, ${failCount} failed`)
  
  // Broadcast sync completion with results
  chrome.runtime.sendMessage({
    type: 'SYNC_COMPLETE',
    success: successCount,
    failed: failCount,
    errors: errors.slice(0, 10), // Limit to 10 errors
  }).catch(() => {})
}

// Set up sync alarm
function startSyncAlarm(): void {
  chrome.alarms.create('sync-pending', { periodInMinutes: 2 })
}
