// Content script: intercepts fetch/XHR responses on AI platform pages
// This script is injected into AI platform pages and monkey-patches fetch
// to capture streaming responses, then sends data to the background service worker.

const INTERCEPT_PATTERNS = [
  // ChatGPT
  '/backend-api/conversation',
  // Gemini
  '/_/BardChatUi/data/',
  '/app/_/data/',
  // Tongyi
  '/dialog/conversation',
  '/qianwen/api/chat',
  '/api/chat/completions',
  // Doubao
  '/chat/api/chat',
  '/samantha/chat/completion',
]

function shouldIntercept(url: string): boolean {
  return INTERCEPT_PATTERNS.some((pattern) => url.includes(pattern))
}

function detectPlatform(): string {
  const host = window.location.hostname
  if (host.includes('openai.com') || host.includes('chatgpt.com')) return 'chatgpt'
  if (host.includes('gemini.google.com')) return 'gemini'
  if (host.includes('tongyi.aliyun.com') || host.includes('qianwen')) return 'tongyi'
  if (host.includes('doubao.com')) return 'doubao'
  return 'unknown'
}

// Monkey-patch fetch to intercept responses
const originalFetch = window.fetch
window.fetch = async function (...args: Parameters<typeof fetch>) {
  const [input, init] = args
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url

  if (!shouldIntercept(url)) {
    return originalFetch.apply(this, args)
  }

  const platform = detectPlatform()
  const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  // Capture request body (user message)
  let requestBody = ''
  if (init?.body) {
    if (typeof init.body === 'string') {
      requestBody = init.body
    } else if (init.body instanceof ArrayBuffer) {
      requestBody = new TextDecoder().decode(init.body)
    }
  }

  console.log(`[AI Inbox] Intercepting ${platform} request: ${url}`)

  try {
    const response = await originalFetch.apply(this, args)

    // Clone the response so we can read it without consuming the original
    const clonedResponse = response.clone()

    // Process in background (don't block the original response)
    processResponse(clonedResponse, platform, requestId, url, requestBody)

    return response
  } catch (err) {
    throw err
  }
}

async function processResponse(
  response: Response,
  platform: string,
  requestId: string,
  url: string,
  requestBody: string
): Promise<void> {
  try {
    const contentType = response.headers.get('content-type') || ''
    let fullBody = ''

    if (contentType.includes('text/event-stream') || contentType.includes('stream')) {
      // SSE streaming response
      const reader = response.body?.getReader()
      if (!reader) return

      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        fullBody += chunk

        // Send chunk to background for real-time tracking
        chrome.runtime.sendMessage({
          type: 'STREAM_CHUNK',
          requestId,
          platform,
          data: chunk,
        }).catch(() => {})
      }
    } else {
      // Regular JSON response
      fullBody = await response.text()
    }

    // Send complete response to background
    chrome.runtime.sendMessage({
      type: 'RESPONSE_COMPLETE',
      requestId,
      platform,
      url,
      body: fullBody,
      requestBody,
      isComplete: true,
    }).catch(() => {})

    console.log(`[AI Inbox] Captured ${platform} response (${fullBody.length} bytes)`)
  } catch (err) {
    console.warn(`[AI Inbox] Failed to capture response:`, err)
  }
}

// Also intercept XMLHttpRequest for platforms that use it
const originalXHROpen = XMLHttpRequest.prototype.open
const originalXHRSend = XMLHttpRequest.prototype.send

XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: any[]) {
  (this as any)._aiinbox_url = url.toString();
  (this as any)._aiinbox_method = method
  return originalXHROpen.apply(this, [method, url, ...rest] as any)
}

XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
  const url = (this as any)._aiinbox_url || ''

  if (shouldIntercept(url)) {
    const platform = detectPlatform()
    const requestId = `xhr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    this.addEventListener('load', function () {
      const responseText = this.responseText || ''
      chrome.runtime.sendMessage({
        type: 'RESPONSE_COMPLETE',
        requestId,
        platform,
        url,
        body: responseText,
        requestBody: typeof body === 'string' ? body : '',
        isComplete: true,
      }).catch(() => {})
      console.log(`[AI Inbox] XHR captured ${platform} (${responseText.length} bytes)`)
    })
  }

  return originalXHRSend.apply(this, [body] as any)
}

console.log(`[AI Inbox] Content script loaded on ${detectPlatform()} (${window.location.hostname})`)
