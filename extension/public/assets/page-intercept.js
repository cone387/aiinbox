// Page-level script injected into AI platform pages.
// Intercepts fetch to capture streaming responses.
// Communicates with content script via window.postMessage.

(function () {
  'use strict'

  const INTERCEPT_PATTERNS = [
    '/backend-api/conversation',
    '/_/BardChatUi/data/',
    '/app/_/data/',
    '/dialog/conversation',
    '/qianwen/api/chat',
    '/api/chat/completions',
    '/chat/api/chat',
    '/samantha/chat/completion',
  ]

  function shouldIntercept(url) {
    return INTERCEPT_PATTERNS.some(function (p) { return url.includes(p) })
  }

  function detectPlatform() {
    var host = window.location.hostname
    if (host.includes('openai.com') || host.includes('chatgpt.com')) return 'chatgpt'
    if (host.includes('gemini.google.com')) return 'gemini'
    if (host.includes('tongyi.aliyun.com') || host.includes('qianwen')) return 'tongyi'
    if (host.includes('doubao.com')) return 'doubao'
    return 'unknown'
  }

  function sendToExtension(payload) {
    window.postMessage({ source: 'aiinbox-page', type: 'RESPONSE_COMPLETE', payload: payload }, '*')
  }

  // Monkey-patch fetch
  var originalFetch = window.fetch
  window.fetch = function () {
    var args = arguments
    var input = args[0]
    var init = args[1]
    var url = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input && input.url ? input.url : ''))

    if (!shouldIntercept(url)) {
      return originalFetch.apply(this, args)
    }

    var platform = detectPlatform()
    var requestId = Date.now() + '_' + Math.random().toString(36).slice(2, 8)

    // Capture request body
    var requestBody = ''
    if (init && init.body) {
      if (typeof init.body === 'string') {
        requestBody = init.body
      }
    }

    console.log('[AI Inbox] Intercepting ' + platform + ' fetch: ' + url)

    return originalFetch.apply(this, args).then(function (response) {
      var cloned = response.clone()

      // Process in background
      processResponse(cloned, platform, requestId, url, requestBody)

      return response
    })
  }

  function processResponse(response, platform, requestId, url, requestBody) {
    var contentType = response.headers.get('content-type') || ''

    if (contentType.includes('text/event-stream') || contentType.includes('stream')) {
      // SSE streaming
      var reader = response.body && response.body.getReader()
      if (!reader) return

      var decoder = new TextDecoder()
      var fullBody = ''

      function readChunk() {
        reader.read().then(function (result) {
          if (result.done) {
            sendToExtension({
              requestId: requestId,
              platform: platform,
              url: url,
              body: fullBody,
              requestBody: requestBody,
              isComplete: true,
            })
            console.log('[AI Inbox] Captured ' + platform + ' stream (' + fullBody.length + ' bytes)')
            return
          }
          fullBody += decoder.decode(result.value, { stream: true })
          readChunk()
        }).catch(function (err) {
          // Stream error, send what we have
          if (fullBody.length > 0) {
            sendToExtension({
              requestId: requestId,
              platform: platform,
              url: url,
              body: fullBody,
              requestBody: requestBody,
              isComplete: false,
            })
          }
          console.warn('[AI Inbox] Stream read error:', err)
        })
      }
      readChunk()
    } else {
      // Regular response
      response.text().then(function (text) {
        sendToExtension({
          requestId: requestId,
          platform: platform,
          url: url,
          body: text,
          requestBody: requestBody,
          isComplete: true,
        })
        console.log('[AI Inbox] Captured ' + platform + ' response (' + text.length + ' bytes)')
      }).catch(function () {})
    }
  }

  // Also patch XMLHttpRequest
  var originalOpen = XMLHttpRequest.prototype.open
  var originalSend = XMLHttpRequest.prototype.send

  XMLHttpRequest.prototype.open = function (method, url) {
    this._aiinbox_url = url ? url.toString() : ''
    return originalOpen.apply(this, arguments)
  }

  XMLHttpRequest.prototype.send = function (body) {
    var url = this._aiinbox_url || ''
    if (shouldIntercept(url)) {
      var platform = detectPlatform()
      var requestId = 'xhr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
      var reqBody = typeof body === 'string' ? body : ''

      this.addEventListener('load', function () {
        sendToExtension({
          requestId: requestId,
          platform: platform,
          url: url,
          body: this.responseText || '',
          requestBody: reqBody,
          isComplete: true,
        })
        console.log('[AI Inbox] XHR captured ' + platform + ' (' + (this.responseText || '').length + ' bytes)')
      })
    }
    return originalSend.apply(this, arguments)
  }

  console.log('[AI Inbox] Page interceptor loaded on ' + detectPlatform())
})()
