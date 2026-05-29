// Content script (ISOLATED world) - runs at document_start
// Injects page-intercept.js and relays captured data to background

// Inject immediately - at document_start, documentElement exists but head/body may not
const s = document.createElement('script')
s.src = chrome.runtime.getURL('assets/page-intercept.js')
const target = document.head || document.documentElement
if (target) {
  target.appendChild(s)
} else {
  // Fallback: wait for head
  const observer = new MutationObserver(() => {
    if (document.head) {
      document.head.appendChild(s)
      observer.disconnect()
    }
  })
  observer.observe(document.documentElement, { childList: true })
}

// Relay messages from page script to background service worker
window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (!event.data || event.data.source !== 'aiinbox-page') return

  const { type, payload } = event.data
  if (type === 'RESPONSE_COMPLETE' && payload) {
    chrome.runtime.sendMessage({
      type: 'RESPONSE_COMPLETE',
      ...payload,
    }).catch(() => {})
  }
})
