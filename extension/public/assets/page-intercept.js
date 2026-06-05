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

  // ===== One-click full history sync =====
  // Driven by the extension (popup → background → content script → here).
  // Uses originalFetch so our own requests are NOT re-intercepted.

  var SYNC_THROTTLE_MS = 600   // base delay between requests; grows on 429
  var syncThrottle = SYNC_THROTTLE_MS
  var syncFailed = 0
  var syncRunning = false
  var planResolver = null // resolves with the toFetch id list from background

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms) })
  }

  function postProgress(fields) {
    window.postMessage({ source: 'aiinbox-page', type: 'SYNC_PROGRESS', payload: fields }, '*')
  }

  // Forward a human-readable line to the extension log buffer (查看日志).
  function syncLog(msg, level) {
    console.log('[AI Inbox][sync] ' + msg)
    window.postMessage({ source: 'aiinbox-page', type: 'SYNC_LOG', payload: { msg: '[sync] ' + msg, level: level || 'INFO' } }, '*')
  }

  // Wait for background's incremental plan (toFetch ids) relayed via content script.
  // Rejects after 30s so a dropped reply doesn't hang the whole sync in 'listing'.
  function requestPlan(platform, items) {
    return new Promise(function (resolve, reject) {
      var to = setTimeout(function () {
        planResolver = null
        reject(new Error('plan_timeout'))
      }, 30000)
      planResolver = function (v) {
        clearTimeout(to)
        resolve(v)
      }
      window.postMessage({ source: 'aiinbox-page', type: 'SYNC_HISTORY_PLAN', payload: { platform: platform, items: items } }, '*')
    })
  }

  function getChatGPTToken() {
    return originalFetch('/api/auth/session', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (j) { return j && j.accessToken ? j.accessToken : '' })
      .catch(function () { return '' })
  }

  // Paginate the conversations list. Returns [{ id, updateTime }].
  function chatgptListAll(token) {
    var headers = { 'Authorization': 'Bearer ' + token }
    var items = []
    var offset = 0
    var limit = 28
    var total = Infinity

    function step(retry) {
      var url = '/backend-api/conversations?offset=' + offset + '&limit=' + limit + '&order=updated'
      return originalFetch(url, { headers: headers, credentials: 'include' }).then(function (r) {
        if (r.status === 429) {
          retry = retry || 0
          if (retry < 4) {
            var wait = Math.min(2000 * Math.pow(2, retry), 30000)
            syncLog('列举对话 429 限流，' + Math.round(wait / 1000) + 's 后重试', 'WARN')
            return sleep(wait).then(function () { return step(retry + 1) })
          }
          syncLog('列举对话多次 429 后中止，已收集 ' + items.length + ' 条', 'ERROR')
          return items
        }
        if (!r.ok) {
          syncLog('列举对话失败 HTTP ' + r.status, 'ERROR')
          return items
        }
        return r.json().then(function (j) {
          if (typeof j.total === 'number') total = j.total
          var list = j.items || []
          for (var i = 0; i < list.length; i++) {
            items.push({ id: list[i].id, updateTime: list[i].update_time })
          }
          offset += limit
          // Heartbeat: lets the popup show a running count and resets the
          // background watchdog during long enumerations.
          postProgress({ phase: 'listing', done: items.length, total: total === Infinity ? 0 : total, failed: 0 })
          if (list.length === 0 || offset >= total) return items
          return sleep(syncThrottle).then(function () { return step(0) })
        })
      })
    }
    return step(0)
  }

  // Fetch a single conversation with exponential backoff on 429.
  // Returns { ok, text, status }. Grows syncThrottle when rate-limited so the
  // whole run slows down, not just the retried request.
  function fetchConversation(id, token, attempt) {
    attempt = attempt || 0
    var headers = { 'Authorization': 'Bearer ' + token }
    return originalFetch('/backend-api/conversation/' + id, { headers: headers, credentials: 'include' }).then(function (r) {
      if (r.status === 429) {
        // Back off: grow the global throttle (cap 8s) and wait progressively longer.
        syncThrottle = Math.min(Math.round(syncThrottle * 1.5), 8000)
        if (attempt < 4) {
          var wait = Math.min(2000 * Math.pow(2, attempt), 30000)
          syncLog('429 限流，' + Math.round(wait / 1000) + 's 后重试 (第 ' + (attempt + 1) + ' 次)，节流升至 ' + syncThrottle + 'ms', 'WARN')
          return sleep(wait).then(function () { return fetchConversation(id, token, attempt + 1) })
        }
        syncLog('对话 ' + id + ' 多次 429 后放弃', 'ERROR')
        return { ok: false, text: null, status: 429 }
      }
      if (!r.ok) {
        syncLog('对话 ' + id + ' 拉取失败 HTTP ' + r.status, 'ERROR')
        return { ok: false, text: null, status: r.status }
      }
      return r.text().then(function (t) { return { ok: true, text: t, status: 200 } })
    }).catch(function (err) {
      syncLog('对话 ' + id + ' 网络错误: ' + String(err), 'ERROR')
      return { ok: false, text: null, status: 0 }
    })
  }

  function runFullSync(platform) {
    if (syncRunning) return
    syncRunning = true
    syncThrottle = SYNC_THROTTLE_MS
    syncFailed = 0

    if (platform !== 'chatgpt') {
      postProgress({ phase: 'error', error: 'unsupported' })
      syncRunning = false
      return
    }

    syncLog('开始同步 ChatGPT 全部历史')
    postProgress({ phase: 'listing', done: 0, total: 0, failed: 0 })

    getChatGPTToken().then(function (token) {
      if (!token) {
        syncLog('未取得 accessToken，请确认已登录 ChatGPT', 'ERROR')
        postProgress({ phase: 'error', error: 'no_token' })
        syncRunning = false
        return
      }
      chatgptListAll(token).then(function (items) {
        syncLog('共列举到 ' + items.length + ' 条对话，请求增量计划…')
        // Ask background which ones actually need fetching (incremental).
        // Return the chain so a plan timeout/rejection reaches the outer catch.
        return requestPlan(platform, items).then(function (toFetch) {
          var ids = toFetch || []
          syncLog('需要拉取 ' + ids.length + ' 条（其余已是最新）')
          postProgress({ phase: 'fetching', done: 0, total: ids.length, failed: 0 })
          if (ids.length === 0) {
            postProgress({ phase: 'done', done: 0, total: 0, failed: 0 })
            syncRunning = false
            return
          }

          var i = 0
          function next() {
            if (i >= ids.length) {
              syncLog('同步完成：成功 ' + (ids.length - syncFailed) + ' / ' + ids.length + '，失败 ' + syncFailed, syncFailed ? 'WARN' : 'INFO')
              postProgress({ phase: 'done', done: ids.length, total: ids.length, failed: syncFailed })
              syncRunning = false
              return
            }
            var id = ids[i]
            fetchConversation(id, token, 0).then(function (res) {
              if (res && res.ok && res.text) {
                sendToExtension({
                  requestId: 'sync_' + Date.now() + '_' + i,
                  platform: platform,
                  url: '/backend-api/conversation/' + id,
                  body: res.text,
                  requestBody: '',
                  isComplete: true,
                  captureMode: 'history',
                })
              } else {
                syncFailed++
              }
              i++
              postProgress({ phase: 'fetching', done: i, total: ids.length, failed: syncFailed })
              sleep(syncThrottle).then(next)
            })
          }
          next()
        })
      }).catch(function (err) {
        syncLog('同步出错: ' + String(err), 'ERROR')
        postProgress({ phase: 'error', error: String(err) })
        syncRunning = false
      })
    })
  }

  // Listen for commands relayed from the content script (extension side).
  window.addEventListener('message', function (event) {
    if (event.source !== window) return
    var data = event.data
    if (!data || data.source !== 'aiinbox-ext') return

    if (data.type === 'SYNC_ALL_HISTORY') {
      runFullSync(data.platform)
    } else if (data.type === 'SYNC_HISTORY_PLAN_RESULT') {
      if (planResolver) {
        var resolve = planResolver
        planResolver = null
        resolve((data.payload && data.payload.toFetch) || [])
      }
    }
  })

  console.log('[AI Inbox] Page interceptor loaded on ' + detectPlatform())
})()
