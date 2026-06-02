(function () {
  'use strict'

  var INTERCEPT_RULES = [
    // ===== ChatGPT (adapted) =====
    // POST: new turn / streaming response
    { pattern: '/backend-api/conversation', method: 'POST', exclude: ['/conversations', '/stream_status', '/textdocs', '/init'], mode: 'turn' },
    { pattern: '/backend-api/f/conversation', method: 'POST', exclude: ['/conversations', '/stream_status', '/textdocs', '/init', '/prepare'], mode: 'turn' },
    // GET: load existing conversation (history)
    { pattern: '/backend-api/conversation/', method: 'GET', exclude: ['/conversations', '/stream_status', '/textdocs', '/init'], mode: 'history' },

    // ===== Gemini (pending adaptation — need Playwright capture) =====
    // TODO: verify turn POST pattern and add history GET pattern
    { pattern: '/_/BardChatUi/data/', method: 'POST', exclude: [], mode: 'turn' },
    { pattern: '/app/_/data/', method: 'POST', exclude: [], mode: 'turn' },
    // TODO: history GET rule — need real API path

    // ===== Tongyi / Qianwen (pending adaptation — need Playwright capture) =====
    // TODO: verify turn POST pattern and add history GET pattern
    { pattern: '/dialog/conversation', method: 'POST', exclude: [], mode: 'turn' },
    { pattern: '/qianwen/api/chat', method: 'POST', exclude: [], mode: 'turn' },
    // TODO: history GET rule — need real API path

    // ===== Doubao (pending adaptation — need Playwright capture) =====
    // TODO: verify turn POST pattern and add history GET pattern
    { pattern: '/chat/api/chat', method: 'POST', exclude: [], mode: 'turn' },
    { pattern: '/samantha/chat/completion', method: 'POST', exclude: [], mode: 'turn' },
    // TODO: history GET rule — need real API path
  ]

  function shouldIntercept(url, method) {
    for (var i = 0; i < INTERCEPT_RULES.length; i++) {
      var rule = INTERCEPT_RULES[i]
      if (url.includes(rule.pattern)) {
        if (rule.method && rule.method !== method) continue
        var excluded = false
        for (var j = 0; j < rule.exclude.length; j++) {
          if (url.includes(rule.exclude[j])) { excluded = true; break }
        }
        if (!excluded) return rule.mode
      }
    }
    return null
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

  var originalFetch = window.fetch
  window.fetch = function () {
    var args = arguments
    var input = args[0]
    var init = args[1]
    var url = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input && input.url ? input.url : ''))
    var method = (init && init.method) ? init.method.toUpperCase() : 'GET'

    var captureMode = shouldIntercept(url, method)
    if (!captureMode) {
      return originalFetch.apply(this, args)
    }

    var platform = detectPlatform()
    var requestId = Date.now() + '_' + Math.random().toString(36).slice(2, 8)

    var requestBody = ''
    if (init && init.body) {
      if (typeof init.body === 'string') {
        requestBody = init.body
      }
    }

    console.log('[AI Inbox] ' + captureMode + ' ' + platform + ' ' + method + ': ' + url.split('?')[0])

    return originalFetch.apply(this, args).then(function (response) {
      var cloned = response.clone()
      processResponse(cloned, platform, requestId, url, requestBody, captureMode)
      return response
    })
  }

  function processResponse(response, platform, requestId, url, requestBody, captureMode) {
    var contentType = response.headers.get('content-type') || ''

    if (contentType.includes('text/event-stream') || contentType.includes('stream')) {
      var reader = response.body && response.body.getReader()
      if (!reader) return

      var decoder = new TextDecoder()
      var fullBody = ''

      function readChunk() {
        reader.read().then(function (result) {
          if (result.done) {
            console.log('[AI Inbox] Stream complete (' + fullBody.length + ' bytes)')
            sendToExtension({
              requestId: requestId,
              platform: platform,
              url: url,
              body: fullBody,
              requestBody: requestBody,
              isComplete: true,
              captureMode: captureMode,
            })
            return
          }
          fullBody += decoder.decode(result.value, { stream: true })
          readChunk()
        }).catch(function () {
          if (fullBody.length > 0) {
            console.log('[AI Inbox] Stream interrupted, sending partial (' + fullBody.length + ' bytes)')
            sendToExtension({
              requestId: requestId,
              platform: platform,
              url: url,
              body: fullBody,
              requestBody: requestBody,
              isComplete: false,
              captureMode: captureMode,
            })
          }
        })
      }
      readChunk()
    } else {
      response.text().then(function (text) {
        if (text.length > 50) {
          console.log('[AI Inbox] Response captured (' + text.length + ' bytes)')
          sendToExtension({
            requestId: requestId,
            platform: platform,
            url: url,
            body: text,
            requestBody: requestBody,
            isComplete: true,
            captureMode: captureMode,
          })
        }
      }).catch(function () {})
    }
  }

  // Patch XHR too
  var originalOpen = XMLHttpRequest.prototype.open
  var originalSend = XMLHttpRequest.prototype.send

  XMLHttpRequest.prototype.open = function (method, url) {
    this._aiinbox_url = url ? url.toString() : ''
    this._aiinbox_method = method ? method.toUpperCase() : 'GET'
    return originalOpen.apply(this, arguments)
  }

  XMLHttpRequest.prototype.send = function (body) {
    var url = this._aiinbox_url || ''
    var method = this._aiinbox_method || 'GET'
    var captureMode = shouldIntercept(url, method)
    if (captureMode) {
      var platform = detectPlatform()
      var requestId = 'xhr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
      var reqBody = typeof body === 'string' ? body : ''

      this.addEventListener('load', function () {
        var text = this.responseText || ''
        if (text.length > 50) {
          sendToExtension({
            requestId: requestId,
            platform: platform,
            url: url,
            body: text,
            requestBody: reqBody,
            isComplete: true,
            captureMode: captureMode,
          })
        }
      })
    }
    return originalSend.apply(this, arguments)
  }

  console.log('[AI Inbox] Page interceptor loaded on ' + detectPlatform())
})()
