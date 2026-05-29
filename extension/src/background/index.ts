import { getAdapter } from '../adapters'
import { collector } from '../storage/collector'
import { syncService } from '../sync/service'
import { ExtensionConfig, Platform, SyncStatus } from '../types'
import { secureStorage } from '../utils/crypto'

// Stream buffers for SSE responses
const streamBuffers = new Map<string, { data: string; lastChunkTime: number; platform: Platform }>()

// Timeout checker interval
const STREAM_TIMEOUT_MS = 30000
const MAX_STREAM_SIZE = 50 * 1024 * 1024 // 50MB

let config: ExtensionConfig | null = null
let isCollecting = false

// Initialize on install
chrome.runtime.onInstalled.addListener(() => {
  console.log('AI Chat Collector: Extension installed')
  loadConfig()
})

// Initialize on startup
chrome.runtime.onStartup.addListener(() => {
  loadConfig()
})

// Load config and start collecting
async function loadConfig(): Promise<void> {
  const stored = await chrome.storage.local.get('config')
  if (stored.config) {
    config = stored.config as ExtensionConfig

    // Decrypt token
    if (config.authToken) {
      try {
        config.authToken = await secureStorage.decrypt(config.authToken)
      } catch {
        // Token not encrypted or decryption failed
      }
    }

    if (config.isCollecting && config.serverUrl && config.authToken) {
      startCollecting()
    }
  }
}

function startCollecting(): void {
  if (isCollecting || !config) return
  isCollecting = true

  // Start sync service
  syncService.start({
    serverUrl: config.serverUrl,
    authToken: config.authToken,
    mode: config.syncMode,
    batchInterval: config.batchInterval,
    maxRetries: 5,
  })

  // Start stream timeout checker
  setInterval(checkStreamTimeouts, 5000)

  updateIcon('active')
  console.log('AI Chat Collector: Started collecting')
}

function stopCollecting(): void {
  isCollecting = false
  syncService.stop()
  streamBuffers.clear()
  updateIcon('paused')
  console.log('AI Chat Collector: Stopped collecting')
}

// Listen for fetch events via chrome.webRequest
// Note: In Manifest V3, we use chrome.webRequest.onCompleted for non-streaming
// For streaming, we use a content script approach or declarativeNetRequest
// Here we use chrome.webRequest.onBeforeRequest to detect requests,
// then fetch the response ourselves in the background

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!isCollecting || !config) return
    if (details.method !== 'POST') return

    const adapter = getAdapter(details.url)
    if (!adapter) return

    // Check if platform is enabled
    if (!config.enabledPlatforms.includes(adapter.platform)) return

    // Track this request for response capture
    console.log(`AI Chat Collector: Intercepted ${adapter.platform} request: ${details.url}`)
  },
  {
    urls: [
      'https://chat.openai.com/backend-api/conversation*',
      'https://chatgpt.com/backend-api/conversation*',
      'https://gemini.google.com/_/BardChatUi/data/*',
      'https://gemini.google.com/app/_/data/*',
      'https://qianwen.biz.aliyun.com/dialog/conversation*',
      'https://tongyi.aliyun.com/qianwen/api/chat*',
      'https://www.doubao.com/chat/api/chat*',
      'https://www.doubao.com/samantha/chat/completion*',
    ],
  }
)

chrome.webRequest.onCompleted.addListener(
  async (details) => {
    if (!isCollecting || !config) return

    const adapter = getAdapter(details.url)
    if (!adapter) return
    if (!config.enabledPlatforms.includes(adapter.platform)) return

    // For completed requests, check if we have buffered stream data
    const buffer = streamBuffers.get(details.requestId)
    if (buffer) {
      await processStreamBuffer(details.requestId, true)
    }
  },
  {
    urls: [
      'https://chat.openai.com/backend-api/conversation*',
      'https://chatgpt.com/backend-api/conversation*',
      'https://gemini.google.com/_/BardChatUi/data/*',
      'https://gemini.google.com/app/_/data/*',
      'https://qianwen.biz.aliyun.com/dialog/conversation*',
      'https://tongyi.aliyun.com/qianwen/api/chat*',
      'https://www.doubao.com/chat/api/chat*',
      'https://www.doubao.com/samantha/chat/completion*',
    ],
  }
)

// Process buffered stream data
async function processStreamBuffer(requestId: string, isComplete: boolean): Promise<void> {
  const buffer = streamBuffers.get(requestId)
  if (!buffer) return

  streamBuffers.delete(requestId)

  const adapter = getAdapter('')
  // Find adapter by platform
  const { getAdapterByPlatform } = await import('../adapters')
  const platformAdapter = getAdapterByPlatform(buffer.platform)
  if (!platformAdapter) return

  const result = platformAdapter.parseResponse({
    requestId,
    tabId: 0,
    platform: buffer.platform,
    url: '',
    statusCode: 200,
    body: buffer.data,
    isComplete,
    timestamp: new Date().toISOString(),
  })

  if (result.success && result.conversation) {
    await collector.save(result.conversation)
    syncService.triggerSync()
    console.log(`AI Chat Collector: Saved conversation from ${buffer.platform}`)
  } else if (!result.success && buffer.data.length > 0) {
    // Save raw data for failed parses
    await collector.saveRaw(buffer.platform, buffer.data.slice(0, 1_000_000))
    console.warn(`AI Chat Collector: Parse failed for ${buffer.platform}: ${result.error}`)
  }
}

// Check for timed-out streams
function checkStreamTimeouts(): void {
  const now = Date.now()
  for (const [requestId, buffer] of streamBuffers) {
    if (now - buffer.lastChunkTime > STREAM_TIMEOUT_MS) {
      console.log(`AI Chat Collector: Stream timeout for ${requestId}`)
      processStreamBuffer(requestId, false)
    }
  }
}

// Receive stream chunks from content script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'STREAM_CHUNK') {
    const { requestId, data, platform } = message
    const buffer = streamBuffers.get(requestId) || { data: '', lastChunkTime: 0, platform }

    // Size limit check
    if (buffer.data.length + data.length > MAX_STREAM_SIZE) {
      processStreamBuffer(requestId, false)
      sendResponse({ ok: true })
      return
    }

    buffer.data += data
    buffer.lastChunkTime = Date.now()
    streamBuffers.set(requestId, buffer)
    sendResponse({ ok: true })
  } else if (message.type === 'STREAM_END') {
    processStreamBuffer(message.requestId, true)
    sendResponse({ ok: true })
  } else if (message.type === 'GET_STATUS') {
    sendResponse({
      isCollecting,
      status: isCollecting ? 'active' : 'paused',
    })
  } else if (message.type === 'TOGGLE_COLLECTING') {
    if (isCollecting) {
      stopCollecting()
    } else {
      startCollecting()
    }
    sendResponse({ isCollecting })
  } else if (message.type === 'CONFIG_UPDATED') {
    loadConfig()
    sendResponse({ ok: true })
  }
  return true
})

// Update extension icon
function updateIcon(status: 'active' | 'paused' | 'error'): void {
  const colors: Record<string, string> = {
    active: '#22c55e',
    paused: '#9ca3af',
    error: '#ef4444',
  }
  chrome.action.setBadgeBackgroundColor({ color: colors[status] })
  chrome.action.setBadgeText({ text: status === 'active' ? '' : status === 'paused' ? '⏸' : '!' })
}
