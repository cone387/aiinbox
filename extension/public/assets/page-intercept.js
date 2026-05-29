(function () {
  'use strict'

  // Only intercept POST requests to actual chat completion endpoints
  var INTERCEPT_RULES = [
    // ChatGPT: only POST to /backend-api/conversation (not /conversations, /stream_status, etc)
    { pattern: '/backend-api/conversation', method: 'POST', exclude: ['/conversations', '/stream_status', '/textdocs', '/init'] },
    // Gemini
    { pattern: '/_/BardChatUi/data/', method: 'POST', exclude: [] },
    { pattern: '/app/_/data/', method: 'POST', exclude: [] },
    // Tongyi
    { pattern: '/dialog/conversation', method: 'POST', exclude: [] },
    { pattern: '/qianwen/api/chat', method: 'POST', exclude: [] },
    // Doubao
    { pattern: '/chat/api/chat', method: 'POST', exclude: [] },
    { pattern: '/samantha/chat/completion', method: 'POST', exclude: [] },
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
        if (!excluded) return true
      }
    }
    return false
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

    if (!shouldIntercept(url, method)) {
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

    console.log('[AI Inbox] Intercepting ' + platform + ' POST: ' + url.split('?')[0])

    return originalFetch.apply(this, args).then(function (response) {
      var cloned = response.clone()
      processResponse(cloned, platform, requestId, url, requestBody)
      return response
    })
  }

  function processResponse(response, platform, requestId, url, requestBody) {
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
            })
            return
          }
          fullBody += decoder.decode(result.value, { stream: true })
          readChunk()
        }).catch(function (err) {
          if (fullBody.length > 0) {
            console.log('[AI Inbox] Stream interrupted, sending partial (' + fullBody.length + ' bytes)')
            sendToExtension({
              requestId: requestId,
              platform: platform,
              url: url,
              body: fullBody,
              requestBody: requestBody,
              isComplete: false,
            })
          }
        })
      }
      readChunk()
    } else {
      response.text().then(function (text) {
        // Only send if it looks like conversation data (has reasonable size)
        if (text.length > 50) {
          console.log('[AI Inbox] Response captured (' + text.length + ' bytes)')
          sendToExtension({
            requestId: requestId,
            platform: platform,
            url: url,
            body: text,
            requestBody: requestBody,
            isComplete: true,
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
    if (shouldIntercept(url, method)) {
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
          })
        }
      })
    }
    return originalSend.apply(this, arguments)
  }

  console.log('[AI Inbox] Page interceptor loaded on ' + detectPlatform())
})()
