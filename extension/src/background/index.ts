import { getAdapterByPlatform } from '../adapters'
import { collector } from '../storage/collector'
import { syncService } from '../sync/service'
import { ExtensionConfig, Platform, DEFAULT_CONFIG, PLATFORM_URL_PATTERNS } from '../types'
import { secureStorage } from '../utils/crypto'

let config: ExtensionConfig = DEFAULT_CONFIG
let isCollecting = false

// Initialize
chrome.runtime.onInstalled.addListener(() => {
  console.log('[AI Inbox] Extension installed')
  loadConfig()
})

chrome.runtime.onStartup.addListener(() => {
  loadConfig()
})

// Load on script start (service worker wake)
loadConfig()

async function loadConfig(): Promise<void> {
  const stored = await chrome.storage.local.get('config')
  if (stored.config) {
    config = stored.config as ExtensionConfig
  } else {
    // Save default config on first run
    await chrome.storage.local.set({ config: DEFAULT_CONFIG })
    config = DEFAULT_CONFIG
  }

  const server = config.servers[config.activeServerIndex]
  if (config.isCollecting && server?.url && server?.token) {
    startCollecting()
  }
}

function startCollecting(): void {
  if (isCollecting) return
  isCollecting = true

  const server = config.servers[config.activeServerIndex]
  if (!server) return

  syncService.start({
    serverUrl: server.url,
    authToken: server.token,
    mode: config.syncMode,
    batchInterval: config.batchInterval,
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

// Health check for a server
async function checkServerHealth(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`, { method: 'GET', signal: AbortSignal.timeout(5000) })
    if (response.ok) {
      const data = await response.json()
      return data.status === 'ok'
    }
    return false
  } catch {
    return false
  }
}

// Detect platform from tab URL
function detectPlatformFromUrl(url: string): Platform | null {
  for (const [platform, patterns] of Object.entries(PLATFORM_URL_PATTERNS)) {
    if (patterns.some((p) => url.includes(p))) {
      return platform as Platform
    }
  }
  return null
}

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse)
  return true // Keep channel open for async response
})

async function handleMessage(message: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) {
  switch (message.type) {
    case 'RESPONSE_COMPLETE': {
      if (!isCollecting) { sendResponse({ ok: false }); return }

      const platform = message.platform as Platform
      if (!config.enabledPlatforms.includes(platform)) { sendResponse({ ok: false }); return }

      const adapter = getAdapterByPlatform(platform)
      if (!adapter) { sendResponse({ ok: false }); return }

      const result = adapter.parseResponse({
        requestId: message.requestId,
        tabId: 0,
        platform,
        url: message.url,
        statusCode: 200,
        body: message.body,
        isComplete: message.isComplete,
        timestamp: new Date().toISOString(),
      })

      if (result.success && result.conversation) {
        await collector.save(result.conversation)
        syncService.triggerSync()
        console.log(`[AI Inbox] Saved conversation from ${platform} (${result.conversation.messages.length} messages)`)
      } else if (message.body?.length > 0) {
        await collector.saveRaw(platform, message.body.slice(0, 1_000_000))
        console.warn(`[AI Inbox] Parse failed for ${platform}: ${result.error}`)
      }

      sendResponse({ ok: true })
      break
    }

    case 'STREAM_CHUNK': {
      // For now just log, full response handled by RESPONSE_COMPLETE
      sendResponse({ ok: true })
      break
    }

    case 'GET_STATUS': {
      const tab = await chrome.tabs.query({ active: true, currentWindow: true })
      const currentUrl = tab[0]?.url || ''
      const activePlatform = detectPlatformFromUrl(currentUrl)

      const stats = await collector.getStats()
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
      const healthy = await checkServerHealth(url)
      sendResponse({ healthy })
      break
    }

    case 'SAVE_CONFIG': {
      config = message.config as ExtensionConfig
      await chrome.storage.local.set({ config })

      // Restart sync if needed
      if (isCollecting) {
        stopCollecting()
        startCollecting()
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
}

function updateIcon(status: 'active' | 'paused' | 'error'): void {
  const colors: Record<string, string> = {
    active: '#22c55e',
    paused: '#9ca3af',
    error: '#ef4444',
  }
  chrome.action.setBadgeBackgroundColor({ color: colors[status] })
  chrome.action.setBadgeText({ text: status === 'active' ? '' : status === 'paused' ? '⏸' : '!' })
}
