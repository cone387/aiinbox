// Content script (ISOLATED world)
// Injects interceptor INLINE at document_start to ensure it runs before page scripts

const INTERCEPT_CODE = `
(function() {
  var RULES = [
    { p: '/backend-api/conversation', m: 'POST', ex: ['/conversations', '/stream_status', '/textdocs', '/init'] },
    { p: '/backend-api/sentinel/chat-requirements', m: 'POST', ex: [] },
    { p: '/_/BardChatUi/data/', m: 'POST', ex: [] },
    { p: '/app/_/data/', m: 'POST', ex: [] },
    { p: '/dialog/conversation', m: 'POST', ex: [] },
    { p: '/qianwen/api/chat', m: 'POST', ex: [] },
    { p: '/chat/api/chat', m: 'POST', ex: [] },
    { p: '/samantha/chat/completion', m: 'POST', ex: [] }
  ];

  function match(url, method) {
    for (var i = 0; i < RULES.length; i++) {
      var r = RULES[i];
      if (!url.includes(r.p)) continue;
      if (r.m && r.m !== method) continue;
      var skip = false;
      for (var j = 0; j < r.ex.length; j++) { if (url.includes(r.ex[j])) { skip = true; break; } }
      if (!skip) return true;
    }
    return false;
  }

  function platform() {
    var h = location.hostname;
    if (h.includes('openai.com') || h.includes('chatgpt.com')) return 'chatgpt';
    if (h.includes('gemini.google.com')) return 'gemini';
    if (h.includes('tongyi.aliyun.com') || h.includes('qianwen')) return 'tongyi';
    if (h.includes('doubao.com')) return 'doubao';
    return 'unknown';
  }

  function send(payload) {
    window.postMessage({ source: 'aiinbox-page', type: 'RESPONSE_COMPLETE', payload: payload }, '*');
  }

  var _fetch = window.fetch;
  window.fetch = function() {
    var input = arguments[0], init = arguments[1];
    var url = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input && input.url ? input.url : ''));
    var method = (init && init.method) ? init.method.toUpperCase() : (input && input.method ? input.method.toUpperCase() : 'GET');

    if (!match(url, method)) return _fetch.apply(this, arguments);

    var p = platform();
    var rid = Date.now() + '_' + Math.random().toString(36).slice(2,8);
    var reqBody = '';
    if (init && init.body && typeof init.body === 'string') reqBody = init.body;

    console.log('[AI Inbox] Intercepting ' + p + ' ' + method + ': ' + url.split('?')[0]);

    return _fetch.apply(this, arguments).then(function(response) {
      var clone = response.clone();
      var ct = clone.headers.get('content-type') || '';

      if (ct.includes('text/event-stream') || ct.includes('stream') || ct.includes('octet-stream')) {
        var reader = clone.body && clone.body.getReader();
        if (reader) {
          var dec = new TextDecoder(), body = '';
          (function read() {
            reader.read().then(function(r) {
              if (r.done) {
                console.log('[AI Inbox] Stream done (' + body.length + ' bytes)');
                send({ requestId: rid, platform: p, url: url, body: body, requestBody: reqBody, isComplete: true });
                return;
              }
              body += dec.decode(r.value, {stream:true});
              read();
            }).catch(function() {
              if (body.length > 0) send({ requestId: rid, platform: p, url: url, body: body, requestBody: reqBody, isComplete: false });
            });
          })();
        }
      } else {
        clone.text().then(function(text) {
          if (text.length > 50) {
            console.log('[AI Inbox] Response (' + text.length + ' bytes)');
            send({ requestId: rid, platform: p, url: url, body: text, requestBody: reqBody, isComplete: true });
          }
        }).catch(function(){});
      }
      return response;
    });
  };

  console.log('[AI Inbox] Fetch interceptor active on ' + platform());
})();
`

// Inject inline to run before any page scripts
const script = document.createElement('script')
script.textContent = INTERCEPT_CODE
;(document.documentElement || document.head).prepend(script)
script.remove()

// Relay messages from page to background
window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (!event.data || event.data.source !== 'aiinbox-page') return

  const { type, payload } = event.data
  if (type === 'RESPONSE_COMPLETE' && payload) {
    console.log('[AI Inbox] Relaying:', payload.platform, payload.body?.length, 'bytes')
    chrome.runtime.sendMessage({
      type: 'RESPONSE_COMPLETE',
      ...payload,
    }).then((resp) => {
      console.log('[AI Inbox] Background:', JSON.stringify(resp))
    }).catch((err) => {
      console.error('[AI Inbox] Relay error:', err)
    })
  }
})
