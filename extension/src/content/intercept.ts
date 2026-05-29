// Content script running in ISOLATED world.
// Injects a page-level script to intercept fetch, then relays data to background.

// Inject the interceptor into the page's MAIN world
const script = document.createElement('script')
script.src = chrome.runtime.getURL('assets/page-intercept.js')
script.onload = () => script.remove()
;(document.head || document.documentElement).appendChild(script)

// Listen for messages from the injected page script via window.postMessage
window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (!event.data || event.data.source !== 'aiinbox-page') return

  const { type, payload } = event.data

  if (type === 'RESPONSE_COMPLETE') {
    chrome.runtime.sendMessage({
      type: 'RESPONSE_COMPLETE',
      ...payload,
    }).catch(() => {})
  }
})

// Notify background that content script is loaded
const host = window.location.hostname
let platform = 'unknown'
if (host.includes('openai.com') || host.includes('chatgpt.com')) platform = 'chatgpt'
else if (host.includes('gemini.google.com')) platform = 'gemini'
else if (host.includes('tongyi.aliyun.com') || host.includes('qianwen')) platform = 'tongyi'
else if (host.includes('doubao.com')) platform = 'doubao'

console.log(`[AI Inbox] Content script loaded for ${platform}`)
