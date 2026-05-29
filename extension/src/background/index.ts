import { getAdapterByPlatform } from '../adapters'
import { syncService } from '../sync/service'
import { ExtensionConfig, Platform, DEFAULT_CONFIG } from '../types'

// Lazy-load collector to avoid Dexie initialization issues at service worker startup
let _collector: any = null
async function getCollector() {
  if (!_collector) {
    const mod = await import('../storage/collector')
    _collector = mod.collector
  }
  return _collector
}

// Platform URL detection patterns
const PLATFORM_PATTERNS: Record<string, string[]> = {
  chatgpt: ['chat.openai.com', 'chatgpt.com'],
  gemini: ['gemini.google.com'],
  tongyi: ['tongyi.aliyun.com', 'qianwen.aliyun.com'],
  doubao: ['doubao.com'],
}

let config: ExtensionConfig = { ...DEFAULT_CONFIG }
let isCollecting = false

// Initialize
chrome.runtime.onInstalled.addListener(() => {
  console.log('[AI Inbox] Extension installed')
  loadConfig()
})

chrome.runtime.onStartup.addListener(() => {
  loadConfig()
})

// Load on script start (wrapped to catch any initialization errors)
setTimeout(() => loadConfig(), 100)

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
          syncMode: cfg.syncMode || 'realtime',
          batchInterval: cfg.batchInterval || 5,
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
  } catch (err) {
    console.error('[AI Inbox] Failed to load config:', err)
  }
}

function startCollecting(): void {
  if (isCollecting) return
  isCollecting = true

  const server = config.servers?.[config.activeServerIndex]
  if (!server) return

  syncService.start({
    serverUrl: server.url,
    authToken: server.token,
    mode: config.syncMode || 'realtime',
    batchInterval: config.batchInterval || 5,
    maxRetries: 5,
  })

  updateIcon('active')
  console.log('[AI Inbox] Started collecting')
}

function stopCollecting(): void {
  isCollecting = false
  syncService.stop()
  updateIcon('paused')
  console.log('[AI Inbox] Stopped collecting')
}

async function checkServerHealth(url: string): Promise<boolean> {
  try {
    const resp = await fetch(`${url}/health`, { method: 'GET', signal: AbortSignal.timeout(5000) })
    if (resp.ok) {
      const data = await resp.json()
      return data.status === 'ok'
    }
    return false
  } catch {
    return false
  }
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

// Handle messages
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message, sendResponse)
  return true
})

async function handleMessage(message: any, sendResponse: (response?: any) => void) {
  try {
    switch (message.type) {
      case 'RESPONSE_COMPLETE': {
        // Always save locally, even if sync is not configured
        const platform = message.platform as Platform
        if (!config.enabledPlatforms?.includes(platform)) { sendResponse({ ok: false }); return }

        const adapter = getAdapterByPlatform(platform)
        if (!adapter) { sendResponse({ ok: false, error: 'no adapter for ' + platform }); return }

        const result = adapter.parseResponse({
          requestId: message.requestId || '',
          tabId: 0,
          platform,
          url: message.url || '',
          statusCode: 200,
          body: message.body || '',
          isComplete: message.isComplete ?? true,
          timestamp: new Date().toISOString(),
        })

        const coll = await getCollector()

        if (result.success && result.conversation) {
          await coll.save(result.conversation)
          if (isCollecting) {
            syncService.triggerSync()
          }
          console.log(`[AI Inbox] Saved conversation from ${platform} (${result.conversation.messages.length} messages)`)
        } else if (message.body?.length > 100) {
          await coll.saveRaw(platform, message.body.slice(0, 1_000_000))
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

        let stats = { totalConversations: 0, pendingSync: 0, byPlatform: {} as Record<string, number> }
        try {
          const coll = await getCollector()
          stats = await coll.getStats()
        } catch {}

        sendResponse({
          isCollecting,
          status: isCollecting ? 'active' : 'paused',
          activePlatform,
          config,
          stats,
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
        const healthy = await checkServerHealth(message.url as string)
        sendResponse({ healthy })
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
