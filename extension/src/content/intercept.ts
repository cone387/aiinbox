// Content script (ISOLATED world) - runs at document_start
// Injects page-intercept.js and relays captured data to background

// Track whether extension context is still valid
let contextValid = true

// Log forwarding to background
function forwardLog(level: string, msg: string) {
  if (!contextValid) return
  try {
    chrome.runtime.sendMessage({ type: 'LOG', level, msg }).catch(() => {})
  } catch {
    contextValid = false
  }
}

const csLog = (msg: string) => { console.log(msg); forwardLog('INFO', msg) }
const csError = (msg: string) => { console.error(msg); forwardLog('ERROR', msg) }

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
  if (!contextValid) return

  const { type, payload } = event.data
  if (type === 'RESPONSE_COMPLETE' && payload) {
    csLog(`[AI Inbox Content] Relaying ${payload.captureMode} ${payload.platform} ${payload.body?.length} bytes`)
    try {
      chrome.runtime.sendMessage({
        type: 'RESPONSE_COMPLETE',
        ...payload,
      }, (resp) => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || ''
          if (msg.includes('Extension context invalidated')) {
            contextValid = false
          } else {
            csError(`[AI Inbox Content] Chrome runtime error: ${msg}`)
          }
        } else {
          csLog(`[AI Inbox Content] Background responded: ${JSON.stringify(resp)}`)
        }
      })
    } catch (err) {
      contextValid = false
    }
  }
})
