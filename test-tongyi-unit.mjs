// Unit test for TongyiAdapter with real captured data formats
import { TongyiAdapter } from './extension/src/adapters/tongyi.js'

const adapter = new TongyiAdapter()

// ===== Sample Turn SSE (cumulative content) =====
const SAMPLE_TURN_SSE = [
  'data:{"communication":{"sessionid":"5e5bcfff1d2b40bea25da7589cf5ecec","reqid":"36fcc1f505884acaa70a264d3068d41e"},"data":{"messages":[{"mime_type":"signal/post","content":"","status":"processing"}],"extra_info":{"ori_query":"你好，1+1等于几？"}}}',
  '',
  'data:{"communication":{"sessionid":"5e5bcfff1d2b40bea25da7589cf5ecec","reqid":"36fcc1f505884acaa70a264d3068d41e"},"data":{"messages":[{"mime_type":"multi_load/iframe","content":"1+","status":"processing"}]}}',
  '',
  'data:{"communication":{"sessionid":"5e5bcfff1d2b40bea25da7589cf5ecec","reqid":"36fcc1f505884acaa70a264d3068d41e"},"data":{"messages":[{"mime_type":"multi_load/iframe","content":"1+1等于2。","status":"complete"}]}}',
  '',
].join('\n')

// ===== Sample History JSON =====
const SAMPLE_HISTORY = JSON.stringify({
  code: 0,
  data: {
    have_next_page: false,
    list: [
      {
        user_type: 0,
        session_id: '4bda7fc17c51434fa4df91a2d6515b24',
        req_id: 'rtc001',
        request_messages: [{ content: '最近有什么新闻', mime_type: 'text/plain' }],
        response_messages: [{ content: '最近的新闻包括科技领域的AI发展和经济领域的市场变化。', mime_type: 'multi_load/iframe', status: 'complete' }],
        created_at: 1775822325097,
        updated_at: 1775822325128,
      },
      {
        user_type: 0,
        session_id: '4bda7fc17c51434fa4df91a2d6515b24',
        req_id: 'rtc002',
        request_messages: [{ content: '能详细说说AI方面的新闻吗', mime_type: 'text/plain' }],
        response_messages: [{ content: 'AI领域最近发布了多个大语言模型更新，包括GPT系列和Qwen系列的改进。', mime_type: 'multi_load/iframe', status: 'complete' }],
        created_at: 1775822400000,
        updated_at: 1775822400500,
      },
    ],
  },
})

// ===== Sample Session List JSON (for full sync) =====
const SAMPLE_SESSION_LIST = JSON.stringify({
  code: 0,
  data: {
    have_next_page: false,
    next_token: '',
    list: [
      { session_id: '4bda7fc17c51434fa4df91a2d6515b24', title: '最近有什么新闻', created_at: 1775821589493, updated_at: 1775822325131 },
      { session_id: 'abc123', title: '编程问题', created_at: 1775800000000, updated_at: 1775810000000 },
    ],
  },
})

// ===== Run tests =====
let passed = 0
let failed = 0

function assert(condition, msg) {
  if (condition) { passed++; console.log('  ✓ ' + msg) }
  else { failed++; console.error('  ✗ ' + msg) }
}

// Test 1: Turn SSE parsing
console.log('\n=== Test 1: Turn SSE Parsing ===')
const turnResult = adapter.parseResponse({
  requestId: 'test1',
  tabId: 1,
  platform: 'tongyi',
  url: 'https://chat2.qianwen.com/api/v2/chat',
  statusCode: 200,
  body: SAMPLE_TURN_SSE,
  requestBody: JSON.stringify({ messages: [{ content: '你好，1+1等于几？', mime_type: 'text/plain' }], session_id: '5e5bcfff1d2b40bea25da7589cf5ecec' }),
  isComplete: true,
  timestamp: new Date().toISOString(),
  captureMode: 'turn',
  pageTitle: '通义千问',
})

console.log('Result:', JSON.stringify(turnResult, null, 2))
assert(turnResult.success === true, 'Turn parse should succeed')
if (turnResult.conversation) {
  assert(turnResult.conversation.messages.length === 2, 'Turn should have 2 messages (user + assistant)')
  assert(turnResult.conversation.messages[0].role === 'user', 'First message is user')
  assert(turnResult.conversation.messages[0].content === '你好，1+1等于几？', 'User text matches ori_query')
  assert(turnResult.conversation.messages[1].role === 'assistant', 'Second message is assistant')
  assert(turnResult.conversation.messages[1].content === '1+1等于2。', 'Assistant text is from last complete packet')
  assert(turnResult.conversation.conversationId === '5e5bcfff1d2b40bea25da7589cf5ecec', 'Session ID extracted')
  assert(turnResult.conversation.platform === 'tongyi', 'Platform is tongyi')
}

// Test 2: History JSON parsing
console.log('\n=== Test 2: History JSON Parsing ===')
const historyResult = adapter.parseResponse({
  requestId: 'test2',
  tabId: 1,
  platform: 'tongyi',
  url: 'https://chat2-api.qianwen.com/api/v1/session/msg/list?session_id=4bda7fc17c51434fa4df91a2d6515b24',
  statusCode: 200,
  body: SAMPLE_HISTORY,
  requestBody: '',
  isComplete: true,
  timestamp: new Date().toISOString(),
  captureMode: 'history',
  pageTitle: '最近有什么新闻 - 通义千问',
})

console.log('Result:', JSON.stringify(historyResult, null, 2))
assert(historyResult.success === true, 'History parse should succeed')
if (historyResult.conversation) {
  assert(historyResult.conversation.messages.length === 4, 'History should have 4 messages (2 turns × 2)')
  assert(historyResult.conversation.messages[0].role === 'user', 'First message is user')
  assert(historyResult.conversation.messages[0].content === '最近有什么新闻', 'User text correct')
  assert(historyResult.conversation.messages[1].role === 'assistant', 'Second message is assistant')
  assert(historyResult.conversation.messages[2].role === 'user', 'Third message is user')
  assert(historyResult.conversation.messages[3].role === 'assistant', 'Fourth message is assistant')
  assert(historyResult.conversation.conversationId === '4bda7fc17c51434fa4df91a2d6515b24', 'Session ID from history')
  assert(historyResult.conversation.title === '最近有什么新闻', 'Title from page with suffix stripped')
}

// Test 3: Session list parsing (used by full sync, captureMode=history)
console.log('\n=== Test 3: Session List Parsing ===')
const listResult = adapter.parseResponse({
  requestId: 'test3',
  tabId: 1,
  platform: 'tongyi',
  url: 'https://chat2-api.qianwen.com/api/v2/session/page/list',
  statusCode: 200,
  body: SAMPLE_SESSION_LIST,
  requestBody: '',
  isComplete: true,
  timestamp: new Date().toISOString(),
  captureMode: 'history',
  pageTitle: '通义千问',
})

// Session list will be parsed by parseHistoryResponse; it looks for data.list
// which contains sessions, not messages with request_messages/response_messages
console.log('Result:', JSON.stringify(listResult, null, 2))
// The adapter tries to extract request_messages/response_messages from list items,
// which won't be present in session list items. This is expected — full sync
// uses the list API only for enumeration, not for actual message capture.
assert(listResult.success === false || (listResult.conversation && listResult.conversation.messages.length === 0), 
  'Session list should not produce messages (expected for full-sync listing)')

// Test 4: matchRequest
console.log('\n=== Test 4: URL Matching ===')
assert(adapter.matchRequest('https://chat2.qianwen.com/api/v2/chat') === true, 'Match turn URL')
assert(adapter.matchRequest('https://chat2-api.qianwen.com/api/v1/session/msg/list?session_id=abc') === true, 'Match history URL')
assert(adapter.matchRequest('https://chat2-api.qianwen.com/api/v2/session/page/list') === true, 'Match list URL')
assert(adapter.matchRequest('https://www.doubao.com/chat/completion') === false, 'Not match doubao URL')

// Test 5: Title extraction
console.log('\n=== Test 5: Title Extraction ===')
const turnWithTitle = adapter.parseResponse({
  requestId: 'test5',
  tabId: 1,
  platform: 'tongyi',
  url: 'https://chat2.qianwen.com/api/v2/chat',
  statusCode: 200,
  body: SAMPLE_TURN_SSE,
  requestBody: JSON.stringify({ messages: [{ content: '测试消息', mime_type: 'text/plain' }], session_id: 'test' }),
  isComplete: true,
  timestamp: new Date().toISOString(),
  captureMode: 'turn',
  pageTitle: 'AI技术发展讨论 - 通义千问',
})
assert(turnWithTitle.success === true, 'Parse with title succeeds')
if (turnWithTitle.conversation) {
  assert(turnWithTitle.conversation.title === 'AI技术发展讨论', 'Title correctly extracted from page')
}

// Summary
console.log('\n=== Summary ===')
console.log(`Passed: ${passed}, Failed: ${failed}`)
if (failed > 0) process.exit(1)
