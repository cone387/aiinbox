// Content script (ISOLATED world): injects page interceptor and relays messages to background

// Inject the page-level interceptor script
const script = document.createElement('script')
script.src = chrome.runtime.getURL('assets/page-intercept.js')
script.onload = () => script.remove()
;(document.head || document.documentElement).appendChild(script)

// Listen for messages from the injected page script
window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (!event.data || event.data.source !== 'aiinbox-page') return

  const { type, payload } = event.data

  if (type === 'RESPONSE_COMPLETE' && payload) {
    console.log('[AI Inbox CS] Relaying to background:', payload.platform, payload.body?.length, 'bytes')
    chrome.runtime.sendMessage({
      type: 'RESPONSE_COMPLETE',
      ...payload,
    }).then((resp) => {
      console.log('[AI Inbox CS] Background response:', resp)
    }).catch((err) => {
      console.error('[AI Inbox CS] Failed to send to background:', err)
    })
  }
})

console.log('[AI Inbox CS] Content script ready')
