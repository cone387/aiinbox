import { getAdapterByPlatform } from '../adapters'
import { ExtensionConfig, Platform, DEFAULT_CONFIG } from '../types'
import { saveConversation, getPending, markSynced, markFailed, getStats, clearSynced, CachedConversation } from '../storage/db'
import { exportAsJSON } from '../storage/export'

// Platform URL detection patterns
const PLATFORM_PATTERNS: Record<string, string[]> = {
  chatgpt: ['chat.openai.com', 'chatgpt.com'],
  gemini: ['gemini.google.com'],
  tongyi: ['tongyi.aliyun.com', 'qianwen.aliyun.com'],
  doubao: ['doubao.com'],
}

let config: ExtensionConfig = { ...DEFAULT_CONFIG }
let isCollecting = false
let cachedHealth = { server: true, auth: true }
let lastSyncTime: string | null = null
let initPromise: Promise<void>

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
      }
    } else {
      await chrome.storage.local.set({ config: DEFAULT_CONFIG })
      config = { ...DEFAULT_CONFIG }
    }

    const server = config.servers?.[config.activeServerIndex]
    if (config.isCollecting && server?.url && server?.token) {
      startCollecting()
    }

    // Always start health check alarm if server is configured
    if (server?.url && server?.token) {
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
  if (!server?.url || !server?.token) return

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
          }

          try {
            await saveConversation(cached)
            console.log(`[AI Inbox] Cached ${captureMode} from ${platform} (id: ${conv.conversationId})`)
          } catch (err) {
            console.error(`[AI Inbox] Cache write failed:`, err)
          }

          // Attempt immediate upload
          await uploadConversation(cached)
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
        config = message.config as ExtensionConfig
        await chrome.storage.local.set({ config })
        if (isCollecting) {
          stopCollecting()
          const server = config.servers?.[config.activeServerIndex]
          if (server?.url && server?.token) {
            startCollecting()
          }
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
        const stats = await getStats()
        sendResponse({ ...stats, lastSyncTime })
        break
      }

      case 'EXPORT_DATA': {
        const json = await exportAsJSON(message.filter)
        sendResponse({ data: json })
        break
      }

      case 'RETRY_FAILED': {
        syncPendingConversations()
        sendResponse({ ok: true })
        break
      }

      case 'CLEAR_SYNCED': {
        const deleted = await clearSynced()
        sendResponse({ ok: true, deleted })
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

// Upload a cached conversation to the server
async function uploadConversation(conv: CachedConversation): Promise<void> {
  const server = config.servers?.[config.activeServerIndex]
  if (!server?.url || !server?.token) {
    await markFailed(conv.id, 'no_server_configured')
    return
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

  try {
    const resp = await fetch(`${server.url}/api/v1/conversations/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + server.token,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    })

    if (resp.ok) {
      await markSynced(conv.id)
      lastSyncTime = new Date().toISOString()
      console.log(`[AI Inbox] Uploaded ${conv.platform}/${conv.conversationId}`)
    } else {
      const text = await resp.text().catch(() => '')
      await markFailed(conv.id, `${resp.status} - ${text.slice(0, 100)}`)
      console.warn(`[AI Inbox] Upload failed ${resp.status}: ${text.slice(0, 100)}`)
    }
  } catch (err) {
    await markFailed(conv.id, String(err))
    console.warn(`[AI Inbox] Upload error:`, err)
  }
}

// Sync all pending/failed conversations
async function syncPendingConversations(): Promise<void> {
  const server = config.servers?.[config.activeServerIndex]
  if (!server?.url || !server?.token) return
  if (!cachedHealth.server || !cachedHealth.auth) return

  const pending = await getPending()
  if (pending.length === 0) return

  console.log(`[AI Inbox] Syncing ${pending.length} pending conversations`)
  for (const conv of pending) {
    await uploadConversation(conv)
  }
  lastSyncTime = new Date().toISOString()
}

// Set up sync alarm
function startSyncAlarm(): void {
  chrome.alarms.create('sync-pending', { periodInMinutes: 2 })
}
