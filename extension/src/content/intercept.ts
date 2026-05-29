// Content script (ISOLATED world)
// CSP blocks inline scripts, so we must use an external file loaded via chrome.runtime.getURL
// This runs at document_start to inject before page scripts

const script = document.createElement('script')
script.src = chrome.runtime.getURL('assets/page-intercept.js')
script.setAttribute('data-aiinbox', '1')
;(document.documentElement || document.head || document.body).prepend(script)

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
