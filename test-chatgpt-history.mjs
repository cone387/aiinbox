// Test script: Parse ChatGPT history data and upload to backend
import { readFileSync } from 'fs';

const BACKEND_URL = 'http://localhost:9531';
const TEST_USER = 'test@example.com';
const TEST_PASS = 'test123';

// Replicate adapter's parseJSONResponse logic
function parseHistoryJSON(body) {
  const data = JSON.parse(body);
  if (!data.mapping) throw new Error('Not a conversation JSON response');

  const conversationId = data.conversation_id || data.id || '';
  const title = data.title || '';
  const messages = [];

  for (const node of Object.values(data.mapping)) {
    if (node?.message?.content?.parts?.length > 0) {
      const role = node.message.author?.role || 'unknown';
      if (role === 'system') continue;
      const content = node.message.content.parts.join('');
      if (content) {
        messages.push({
          role: role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : role,
          content,
          timestamp: node.message.create_time
            ? new Date(node.message.create_time * 1000).toISOString()
            : undefined,
        });
      }
    }
  }

  messages.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return ta - tb;
  });

  if (messages.length === 0) throw new Error('No messages found');

  return {
    platform: 'chatgpt',
    conversationId: conversationId,
    title: title || messages[0]?.content.slice(0, 50) || 'Untitled',
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      isComplete: true,
    })),
    createdAt: messages[0]?.timestamp || new Date().toISOString(),
    updatedAt: messages[messages.length - 1]?.timestamp || new Date().toISOString(),
  };
}

async function login() {
  const resp = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: TEST_USER, password: TEST_PASS }),
  });
  if (!resp.ok) {
    console.log(`  Login failed (${resp.status}), trying register...`);
    const regResp = await fetch(`${BACKEND_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USER, password: TEST_PASS }),
    });
    if (!regResp.ok) throw new Error(`Register failed: ${regResp.status}`);
    console.log(`  ✓ Registered new user`);
    const loginResp = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USER, password: TEST_PASS }),
    });
    if (!loginResp.ok) throw new Error(`Login failed: ${loginResp.status}`);
    return loginResp.json();
  }
  return resp.json();
}

async function getOrCreateAPIToken(jwt) {
  // List existing tokens first
  const listResp = await fetch(`${BACKEND_URL}/api/v1/auth/tokens`, {
    headers: { 'Authorization': `Bearer ${jwt}` },
  });
  if (listResp.ok) {
    const tokens = await listResp.json();
    if (tokens.length > 0) {
      console.log(`  Found ${tokens.length} existing token(s), using first one`);
      return tokens[0].token;
    }
  }
  // Create new token
  const resp = await fetch(`${BACKEND_URL}/api/v1/auth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt}`,
    },
    body: JSON.stringify({ name: 'test-token' }),
  });
  if (!resp.ok) throw new Error(`Create token failed: ${resp.status}`);
  const data = await resp.json();
  return data.token;
}

async function uploadConversation(token, conversation) {
  const payload = {
    conversations: [{
      platform: conversation.platform,
      conversation_id: conversation.conversationId,
      title: conversation.title,
      messages: conversation.messages.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        is_complete: m.isComplete,
      })),
      created_at: conversation.createdAt,
      updated_at: conversation.updatedAt,
    }],
  };

  const resp = await fetch(`${BACKEND_URL}/api/v1/conversations/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Upload failed: ${resp.status} - ${text}`);
  }
  return resp.json();
}

async function queryConversations(token, conversationId) {
  // List all conversations and find by conversation_id
  const resp = await fetch(`${BACKEND_URL}/api/v1/conversations`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!resp.ok) {
    console.log(`   List failed: ${resp.status}`);
    const text = await resp.text();
    console.log(`   Response: ${text.substring(0, 200)}`);
    return null;
  }
  const data = await resp.json();
  console.log(`   List response keys: ${Object.keys(data).join(', ')}`);
  const list = Array.isArray(data) ? data : data.conversations || data.items || [];
  console.log(`   Found ${list.length} conversations in list`);
  if (list.length > 0) {
    console.log(`   First item keys: ${Object.keys(list[0]).join(', ')}`);
  }
  return list.find(c => c.conversation_id === conversationId) || null;
}

async function queryMessages(token, conversationId) {
  const resp = await fetch(`${BACKEND_URL}/api/v1/conversations/${conversationId}/messages`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  return resp.json();
}

async function getStats(token) {
  const resp = await fetch(`${BACKEND_URL}/api/v1/stats/overview`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  return resp.json();
}

async function main() {
  console.log('=== ChatGPT History Capture Test ===\n');

  // 1. Read and parse the raw JSON data
  const rawJson = readFileSync('./test-data/chatgpt-history-raw.json', 'utf-8');
  console.log(`1. Read ${rawJson.length} bytes of raw JSON`);

  const conv = parseHistoryJSON(rawJson);
  console.log(`2. Parsed conversation:`);
  console.log(`   Title: ${conv.title}`);
  console.log(`   ID: ${conv.conversationId}`);
  console.log(`   Messages: ${conv.messages.length} (${conv.messages.filter(m => m.role === 'user').length} user, ${conv.messages.filter(m => m.role === 'assistant').length} assistant)`);
  console.log(`   Platform: ${conv.platform}`);
  console.log(`   Created: ${conv.createdAt}`);
  console.log();

  // 2. Login to backend
  console.log('3. Logging in to backend...');
  const { access_token } = await login();
  console.log(`   ✓ Got JWT token`);

  // 3. Get API token
  console.log('4. Getting API token...');
  const apiToken = await getOrCreateAPIToken(access_token);
  console.log(`   ✓ API token: ${apiToken.substring(0, 20)}...`);
  console.log();

  // 4. Get stats before upload
  const statsBefore = await getStats(apiToken);
  console.log(`5. Stats before upload: ${statsBefore?.total_conversations || 0} conversations, ${statsBefore?.total_messages || 0} messages`);

  // 5. Upload conversation
  console.log('6. Uploading conversation...');
  const uploadResult = await uploadConversation(apiToken, conv);
  console.log(`   ✓ Upload result:`, JSON.stringify(uploadResult));
  console.log();

  // 6. Query to verify
  console.log('7. Querying to verify...');
  const queried = await queryConversations(apiToken, conv.conversationId);
  if (queried) {
    console.log(`   ✓ Found in database:`);
    console.log(`     Title: ${queried.title}`);
    console.log(`     Platform: ${queried.platform}`);
    console.log(`     Internal ID: ${queried.id}`);

    // Query messages using internal ID
    const msgs = await queryMessages(apiToken, queried.id);
    if (msgs) {
      const msgList = Array.isArray(msgs) ? msgs : msgs.messages || [];
      console.log(`     Messages in DB: ${msgList.length}`);
      msgList.forEach((m, i) => {
        console.log(`       [${i + 1}] ${m.role}: ${m.content?.substring(0, 60)}...`);
      });
    }
  } else {
    console.error('   ✗ Conversation not found in database');
    process.exit(1);
  }

  // 7. Get stats after upload
  const statsAfter = await getStats(apiToken);
  console.log();
  console.log(`8. Stats after upload: ${statsAfter?.total_conversations || 0} conversations, ${statsAfter?.total_messages || 0} messages`);
  if (statsAfter?.platform_distribution) {
    console.log(`   Platform distribution:`, JSON.stringify(statsAfter.platform_distribution));
  }

  console.log('\n=== Test PASSED ===');
}

main().catch(err => {
  console.error('\nTest FAILED:', err.message);
  process.exit(1);
});
