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

    // ===== Tongyi / Qianwen (adapted via Playwright capture) =====
    // POST /api/v2/chat: new turn / streaming reply (SSE)
    { pattern: '/api/v2/chat', method: 'POST', exclude: [], mode: 'turn' },
    // GET /api/v1/session/msg/list: load single conversation messages (history)
    { pattern: '/api/v1/session/msg/list', method: 'GET', exclude: [], mode: 'history' },
    // POST /api/v2/session/page/list: list conversations (used by full-sync only, NOT intercepted)
    // Note: full-sync calls this via originalFetch directly, so no intercept rule needed.

    // ===== Doubao (adapted via live capture) =====
    // POST /chat/completion: new turn / streaming reply (SSE)
    { pattern: '/chat/completion', method: 'POST', exclude: [], mode: 'turn' },
    // POST /im/chain/single: load an existing conversation's messages (history)
    { pattern: '/im/chain/single', method: 'POST', exclude: [], mode: 'history' },

    // ===== DeepSeek (adapted) =====
    // POST /api/v0/chat/completion: new turn / streaming reply (SSE)
    { pattern: '/api/v0/chat/completion', method: 'POST', exclude: ['/create_pow_challenge'], mode: 'turn' },
    // GET /api/v0/chat/history_messages: load single conversation messages (history)
    { pattern: '/api/v0/chat/history_messages', method: 'GET', exclude: [], mode: 'history' },
    // GET /api/v0/chat_session/fetch_page: list conversations (history)
    { pattern: '/api/v0/chat_session/fetch_page', method: 'GET', exclude: [], mode: 'history' },
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
    if (host.includes('tongyi.aliyun.com') || host.includes('qianwen.com') || host.includes('qianwen')) return 'tongyi'
    if (host.includes('doubao.com')) return 'doubao'
    if (host.includes('chat.deepseek.com')) return 'deepseek'
    return 'unknown'
  }

  function sendToExtension(payload) {
    if (payload && payload.pageTitle === undefined) payload.pageTitle = document.title
    window.postMessage({ source: 'aiinbox-page', type: 'RESPONSE_COMPLETE', payload: payload }, '*')
  }

  // Doubao's /im/* endpoints carry session-stable device/web ids in the query
  // string and authenticate via cookies. We stash the query string of any
  // observed /im/ request so full-sync can replay recent_conv / chain/single
  // with the right params (these fire on page load, so it's set before sync).
  var doubaoImQuery = ''
  function rememberImQuery(url) {
    try {
      if (typeof url === 'string' && url.indexOf('/im/') !== -1) {
        var qi = url.indexOf('?')
        if (qi !== -1) doubaoImQuery = url.substring(qi)
      }
    } catch (e) {}
  }

  // Tongyi/Qianwen API endpoints carry auth params (biz_id, ut, nonce, timestamp…)
  // in the query string, added by the page SDK. We stash the query string of any
  // observed chat2-api request so full-sync can replay list/fetch with valid auth.
  var tongyiAuthQuery = ''
  function rememberTongyiQuery(url) {
    try {
      if (typeof url === 'string' && url.indexOf('chat2-api.qianwen.com') !== -1) {
        var qi = url.indexOf('?')
        if (qi !== -1) tongyiAuthQuery = url.substring(qi)
      }
    } catch (e) {}
  }

  var originalFetch = window.fetch
  window.fetch = function () {
    var args = arguments
    var input = args[0]
    var init = args[1]
    var url = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input && input.url ? input.url : ''))
    var method = (init && init.method) ? init.method.toUpperCase() : 'GET'

    rememberImQuery(url)
    rememberTongyiQuery(url)

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
    rememberImQuery(this._aiinbox_url)
    rememberTongyiQuery(this._aiinbox_url)
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
    console.log('[AI Inbox][progress]', JSON.stringify(fields))
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

    if (platform === 'chatgpt') { runChatGPTSync(); return }
    if (platform === 'doubao') { runDoubaoSync(); return }
    if (platform === 'deepseek') { runDeepSeekSync(); return }
    if (platform === 'tongyi') { runTongyiSync(); return }
    postProgress({ phase: 'error', error: 'unsupported' })
    syncRunning = false
  }

  function runChatGPTSync() {
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
        return requestPlan('chatgpt', items).then(function (toFetch) {
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
                  platform: 'chatgpt',
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

  // ===== Doubao full sync =====
  // Replays the page's own cmd-protocol XHRs (cookie-authenticated, no signing):
  //   recent_conv (cmd 3200) lists conversations; chain/single (cmd 3100) pulls
  //   a conversation's messages. Both reuse the observed /im/ query string.
  function doubaoHeaders() {
    return {
      'Content-Type': 'application/json; encoding=utf-8',
      'Agw-Js-Conv': 'str',
      'Accept': 'application/json, text/plain, */*',
    }
  }

  function uuid() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : (Date.now() + '-' + Math.random().toString(36).slice(2))
  }

  // Incremental freshness marker for a conversation, in epoch seconds.
  // Doubao's conversation.update_time is STALE (it does not advance when new
  // messages arrive). The reliable signal is conv_version, whose high digits
  // encode the newest message's create_time: floor(conv_version / 1e6) equals
  // that create_time, which is exactly what the adapter stores as updatedAt —
  // so unchanged conversations compare equal and get skipped. Falls back to
  // update_time only if conv_version is missing/unparseable.
  function doubaoFreshness(c) {
    var cv = Number(c && c.conv_version)
    if (isFinite(cv) && cv > 0) {
      var sec = Math.floor(cv / 1e6)
      if (sec > 1e9) return sec
    }
    return c && c.update_time
  }

  // List every conversation, paginating via next_conv_version until has_more is
  // false. Returns [{ id, name, updateTime }].
  function doubaoListAll() {
    var items = []
    var seenIds = {}
    var seenVersions = {}
    // Pagination, verified by live replay against /im/chain/recent_conv:
    //   - The cursor is conv_version, sent as a NUMBER. The string '0' (and any
    //     string cursor) makes the backend return 712010702 (系统内部异常) with an
    //     empty body. conv_version values are ~1.7e15, well under 2^53, so they
    //     round-trip exactly as JS numbers.
    //   - First page: conv_version 0, direction 3 → newest 50.
    //   - Older pages: conv_version = previous next_conv_version, direction 1.
    //     direction 3/2/4 just re-return the newest 50 and never advance.
    //   - The boundary conversation repeats across pages (cursor is inclusive),
    //     so dedup by conversation_id.
    var convVersion = 0
    var direction = 3

    function step(retry) {
      var body = JSON.stringify({
        cmd: 3200,
        uplink_body: {
          pull_recent_conv_chain_uplink_body: {
            limit: 50, message_count_per_conv: 0, api_version: 1,
            conv_version: convVersion, direction: direction,
            option: { not_need_message: true, need_complete_conversation: true },
          },
        },
        sequence_id: uuid(), channel: 2, version: '1',
      })
      return originalFetch('/im/chain/recent_conv' + doubaoImQuery, {
        method: 'POST', headers: doubaoHeaders(), body: body, credentials: 'include',
      }).then(function (r) {
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
          var b = j && j.downlink_body && j.downlink_body.pull_recent_conv_chain_downlink_body
          if (!b) {
            syncLog('列举对话异常 code=' + (j && j.status_code), 'ERROR')
            return items
          }
          var cells = b.cells || []
          for (var i = 0; i < cells.length; i++) {
            var c = cells[i] && cells[i].conversation
            if (c && c.conversation_id) {
              var id = String(c.conversation_id)
              if (seenIds[id]) continue
              seenIds[id] = true
              items.push({ id: id, name: c.name || '', updateTime: doubaoFreshness(c) })
            }
          }
          postProgress({ phase: 'listing', done: items.length, total: 0, failed: 0 })
          var nv = Number(b.next_conv_version)
          // Stop on no-more, empty page, a non-finite cursor, or a repeated cursor.
          if (b.has_more && cells.length > 0 && isFinite(nv) && nv > 0 && !seenVersions[nv]) {
            seenVersions[nv] = true
            convVersion = nv
            direction = 1
            return sleep(syncThrottle).then(function () { return step(0) })
          }
          return items
        })
      })
    }
    return step(0)
  }

  // Pull all messages of one conversation, paginating older pages by anchor_index.
  // Each page is forwarded as a history capture; the backend merges by
  // conversation_id (and dedups messages), so multiple pages are safe.
  // pageTitle carries the real conversation name so the adapter doesn't fall
  // back to the currently-open tab's title.
  function doubaoFetchConversation(item) {
    var convId = item.id
    var limit = 50
    var page = 0

    function pull(anchorIndex, retry) {
      var body = JSON.stringify({
        cmd: 3100,
        uplink_body: {
          pull_singe_chain_uplink_body: {
            conversation_id: convId, anchor_index: anchorIndex, conversation_type: 3,
            direction: 1, limit: limit, ext: {}, filter: { index_list: [] },
          },
        },
        sequence_id: uuid(), channel: 2, version: '1',
      })
      return originalFetch('/im/chain/single' + doubaoImQuery, {
        method: 'POST', headers: doubaoHeaders(), body: body, credentials: 'include',
      }).then(function (r) {
        if (r.status === 429) {
          syncThrottle = Math.min(Math.round(syncThrottle * 1.5), 8000)
          retry = retry || 0
          if (retry < 4) {
            var wait = Math.min(2000 * Math.pow(2, retry), 30000)
            syncLog('429 限流，' + Math.round(wait / 1000) + 's 后重试，节流升至 ' + syncThrottle + 'ms', 'WARN')
            return sleep(wait).then(function () { return pull(anchorIndex, retry + 1) })
          }
          syncLog('对话 ' + convId + ' 多次 429 后放弃', 'ERROR')
          return { ok: false }
        }
        if (!r.ok) {
          syncLog('对话 ' + convId + ' 拉取失败 HTTP ' + r.status, 'ERROR')
          return { ok: false }
        }
        return r.text().then(function (t) {
          sendToExtension({
            requestId: 'sync_' + Date.now() + '_' + convId + '_' + page,
            platform: 'doubao',
            url: '/im/chain/single',
            body: t,
            requestBody: '',
            isComplete: true,
            captureMode: 'history',
            pageTitle: item.name || '',
          })
          page++

          var count = 0
          var minIndex = null
          try {
            var j = JSON.parse(t)
            var msgs = (j.downlink_body && j.downlink_body.pull_singe_chain_downlink_body
              && j.downlink_body.pull_singe_chain_downlink_body.messages) || []
            count = msgs.length
            for (var i = 0; i < msgs.length; i++) {
              var idx = Number(msgs[i].index_in_conv)
              if (isFinite(idx) && (minIndex === null || idx < minIndex)) minIndex = idx
            }
          } catch (e) {}

          // A full page that doesn't reach index 1 means older messages remain.
          if (count >= limit && minIndex !== null && minIndex > 1) {
            return sleep(syncThrottle).then(function () { return pull(minIndex - 1, 0) })
          }
          return { ok: true }
        })
      }).catch(function (err) {
        syncLog('对话 ' + convId + ' 网络错误: ' + String(err), 'ERROR')
        return { ok: false }
      })
    }
    return pull(9007199254740991, 0)
  }

  function runDoubaoSync() {
    if (!doubaoImQuery) {
      syncLog('未捕获到豆包接口参数，请刷新页面后重试', 'ERROR')
      postProgress({ phase: 'error', error: 'no_params' })
      syncRunning = false
      return
    }

    syncLog('开始同步 豆包 全部历史')
    postProgress({ phase: 'listing', done: 0, total: 0, failed: 0 })

    doubaoListAll().then(function (items) {
      syncLog('共列举到 ' + items.length + ' 条对话，请求增量计划…')
      var byId = {}
      for (var k = 0; k < items.length; k++) byId[items[k].id] = items[k]
      return requestPlan('doubao', items).then(function (toFetch) {
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
          var item = byId[ids[i]] || { id: ids[i], name: '' }
          doubaoFetchConversation(item).then(function (res) {
            if (!res || !res.ok) syncFailed++
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
  }

  // ===== DeepSeek full sync =====
  // Auth: Bearer token from localStorage.userToken (JSON string with .value field)
  // List: GET /api/v0/chat_session/fetch_page?lte_cursor.pinned=false
  // Fetch: GET /api/v0/chat/history_messages?chat_session_id=<id>

  function getDeepSeekToken() {
    try {
      var raw = localStorage.getItem('userToken')
      if (!raw) return ''
      var parsed = JSON.parse(raw)
      return parsed.value || ''
    } catch (e) {
      return ''
    }
  }

  function deepseekHeaders(token) {
    return {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/json, text/plain, */*',
    }
  }

  // List all conversations (first page returns up to 100 items).
  function deepseekListAll(token) {
    return originalFetch('/api/v0/chat_session/fetch_page?lte_cursor.pinned=false', {
      headers: deepseekHeaders(token), credentials: 'include',
    }).then(function (r) {
      if (!r.ok) {
        syncLog('列举对话失败 HTTP ' + r.status, 'ERROR')
        return []
      }
      return r.json().then(function (j) {
        var sessions = (j.data && j.data.biz_data && j.data.biz_data.chat_sessions) || []
        var items = []
        for (var i = 0; i < sessions.length; i++) {
          var s = sessions[i]
          items.push({
            id: s.id,
            name: s.title || '',
            updateTime: s.updated_at,
          })
        }
        postProgress({ phase: 'listing', done: items.length, total: 0, failed: 0 })
        return items
      })
    })
  }

  // Fetch all messages of a single conversation.
  function deepseekFetchConversation(item, token) {
    var convId = item.id
    return originalFetch('/api/v0/chat/history_messages?chat_session_id=' + convId, {
      headers: deepseekHeaders(token), credentials: 'include',
    }).then(function (r) {
      if (r.status === 429) {
        syncThrottle = Math.min(Math.round(syncThrottle * 1.5), 8000)
        syncLog('对话 ' + convId + ' 429 限流', 'WARN')
        return { ok: false }
      }
      if (!r.ok) {
        syncLog('对话 ' + convId + ' 拉取失败 HTTP ' + r.status, 'ERROR')
        return { ok: false }
      }
      return r.text().then(function (t) {
        sendToExtension({
          requestId: 'sync_' + Date.now() + '_' + convId,
          platform: 'deepseek',
          url: '/api/v0/chat/history_messages?chat_session_id=' + convId,
          body: t,
          requestBody: '',
          isComplete: true,
          captureMode: 'history',
          pageTitle: item.name || '',
        })
        return { ok: true }
      })
    }).catch(function (err) {
      syncLog('对话 ' + convId + ' 网络错误: ' + String(err), 'ERROR')
      return { ok: false }
    })
  }

  function runDeepSeekSync() {
    syncLog('开始同步 DeepSeek 全部历史')
    postProgress({ phase: 'listing', done: 0, total: 0, failed: 0 })

    var token = getDeepSeekToken()
    if (!token) {
      syncLog('未取得 DeepSeek token，请确认已登录', 'ERROR')
      postProgress({ phase: 'error', error: 'no_deepseek_token' })
      syncRunning = false
      return
    }

    deepseekListAll(token).then(function (items) {
      syncLog('共列举到 ' + items.length + ' 条对话，请求增量计划…')
      return requestPlan('deepseek', items).then(function (toFetch) {
        var ids = toFetch || []
        syncLog('需要拉取 ' + ids.length + ' 条（其余已是最新）')
        postProgress({ phase: 'fetching', done: 0, total: ids.length, failed: 0 })
        if (ids.length === 0) {
          postProgress({ phase: 'done', done: 0, total: 0, failed: 0 })
          syncRunning = false
          return
        }

        var byId = {}
        for (var k = 0; k < items.length; k++) byId[items[k].id] = items[k]

        var i = 0
        function next() {
          if (i >= ids.length) {
            syncLog('同步完成：成功 ' + (ids.length - syncFailed) + ' / ' + ids.length + '，失败 ' + syncFailed, syncFailed ? 'WARN' : 'INFO')
            postProgress({ phase: 'done', done: ids.length, total: ids.length, failed: syncFailed })
            syncRunning = false
            return
          }
          var item = byId[ids[i]] || { id: ids[i], name: '' }
          deepseekFetchConversation(item, token).then(function (res) {
            if (!res || !res.ok) syncFailed++
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
  }

  // ===== Tongyi / Qianwen full sync =====
  // Auth: cookie-based + SDK-injected query params (ut, nonce, timestamp, biz_id…).
  // We reuse the observed query string from any chat2-api request (fires on page load).
  // List: POST /api/v2/session/page/list  (paginated via next_token)
  // Fetch: GET /api/v1/session/msg/list?session_id=... (paginated via page number)

  function tongyiBaseUrl(path) {
    return 'https://chat2-api.qianwen.com' + path + (tongyiAuthQuery || '')
  }

  function tongyiListAll() {
    var items = []
    var nextToken = ''

    function step(retry) {
      var body = JSON.stringify({
        limit: 50,
        next_token: nextToken,
        sort_field: 'modifiedTime',
        need_filter_tag: true,
      })
      return originalFetch(tongyiBaseUrl('/api/v2/session/page/list'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        credentials: 'include',
      }).then(function (r) {
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
          var d = j && j.data
          if (!d) {
            syncLog('列举对话异常 code=' + (j && j.code), 'ERROR')
            return items
          }
          var list = d.list || []
          for (var i = 0; i < list.length; i++) {
            var s = list[i]
            items.push({
              id: s.session_id,
              name: s.title || '',
              updateTime: s.updated_at, // epoch ms
            })
          }
          postProgress({ phase: 'listing', done: items.length, total: 0, failed: 0 })
          if (d.have_next_page && d.next_token) {
            nextToken = d.next_token
            return sleep(syncThrottle).then(function () { return step(0) })
          }
          return items
        })
      })
    }
    return step(0)
  }

  // Fetch ALL messages of one conversation using cursor-based pagination.
  // The API ignores the `page` number parameter; it uses `pos` (cursor from
  // the last item) for pagination.  We collect all pages, merge the `list`
  // arrays into one body, and send the combined result to the adapter.
  function tongyiFetchConversation(item, retryCount) {
    var convId = item.id
    retryCount = retryCount || 0
    var allItems = []

    function fetchPage(pos) {
      var url = tongyiBaseUrl('/api/v1/session/msg/list')
        + '&session_id=' + encodeURIComponent(convId)
        + '&page_size=10'
        + '&forward=false'
        + '&return_response_messages=true'
        + '&event_filter=all'
      if (pos) url += '&pos=' + encodeURIComponent(pos)

      return originalFetch(url, { credentials: 'include' }).then(function (r) {
        if (r.status === 429) {
          syncThrottle = Math.min(Math.round(syncThrottle * 1.5), 8000)
          if (retryCount < 4) {
            var wait = Math.min(2000 * Math.pow(2, retryCount), 30000)
            syncLog('429 限流，' + Math.round(wait / 1000) + 's 后重试', 'WARN')
            return sleep(wait).then(function () {
              return tongyiFetchConversation(item, retryCount + 1)
            })
          }
          syncLog('对话 ' + convId + ' 多次 429 后放弃', 'ERROR')
          return { ok: false }
        }
        if (!r.ok) {
          syncLog('对话 ' + convId + ' 拉取失败 HTTP ' + r.status, 'ERROR')
          return { ok: false }
        }
        return r.text().then(function (t) {
          var j = JSON.parse(t)
          var list = j.data && j.data.list ? j.data.list : []
          allItems = allItems.concat(list)

          var hasNext = !!(j.data && j.data.have_next_page)
          var lastPos = list.length > 0 ? list[list.length - 1].pos : null

          if (hasNext && lastPos) {
            return sleep(syncThrottle).then(function () { return fetchPage(lastPos) })
          }

          // All pages collected – send the merged body
          sendToExtension({
            requestId: 'sync_' + Date.now() + '_' + convId,
            platform: 'tongyi',
            url: '/api/v1/session/msg/list',
            body: JSON.stringify({ code: 0, data: { list: allItems } }),
            requestBody: '',
            isComplete: true,
            captureMode: 'history',
            pageTitle: item.name || '',
          })
          return { ok: true }
        })
      }).catch(function (err) {
        syncLog('对话 ' + convId + ' 网络错误: ' + String(err), 'ERROR')
        return { ok: false }
      })
    }

    return fetchPage(null)
  }

  function runTongyiSync() {
    if (!tongyiAuthQuery) {
      syncLog('未捕获到通义千问接口参数，请刷新页面后重试', 'ERROR')
      postProgress({ phase: 'error', error: 'no_params' })
      syncRunning = false
      return
    }

    syncLog('开始同步 通义千问 全部历史')
    postProgress({ phase: 'listing', done: 0, total: 0, failed: 0 })

    tongyiListAll().then(function (items) {
      syncLog('共列举到 ' + items.length + ' 条对话，请求增量计划…')
      var byId = {}
      for (var k = 0; k < items.length; k++) byId[items[k].id] = items[k]
      return requestPlan('tongyi', items).then(function (toFetch) {
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
          var item = byId[ids[i]] || { id: ids[i], name: '' }
          tongyiFetchConversation(item).then(function (res) {
            if (!res || !res.ok) syncFailed++
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
