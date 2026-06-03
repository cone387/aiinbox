// Test: Parse ChatGPT turn SSE data and upload to backend
import { readFileSync } from 'fs';

const BACKEND_URL = 'http://localhost:9531';
const TEST_USER = 'test@example.com';
const TEST_PASS = 'test123';

// Replicate adapter's SSE parsing logic
function parseSSE(body, isComplete) {
  const lines = body.split('\n').filter(l => l.startsWith('data: '));
  const messages = [];
  let conversationId = '';
  let title = '';

  for (const line of lines) {
    const data = line.slice(6);
    if (data === '[DONE]') break;

    try {
      const parsed = JSON.parse(data);

      if (typeof parsed === 'string' || parsed.type === 'resume_conversation_token') continue;
      if (parsed.conversation_id) conversationId = parsed.conversation_id;
      if (parsed.title) title = parsed.title;

      // CRDT operations
      if (parsed.o !== undefined && parsed.v !== undefined) {
        if (parsed.o === 'add' && parsed.v?.message?.content?.parts) {
          const msg = parsed.v.message;
          const role = msg.author?.role || 'assistant';
          const content = msg.content?.parts?.join('') || '';
          if (content || role !== 'system') {
            messages.push({
              role,
              content,
              timestamp: msg.create_time ? new Date(msg.create_time * 1000).toISOString() : undefined,
            });
          }
        }
        if (parsed.o === 'append' && typeof parsed.v === 'string') {
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role !== 'system') {
              messages[i].content += parsed.v;
              break;
            }
          }
        }
        if (parsed.o === 'patch' && Array.isArray(parsed.v)) {
          for (const op of parsed.v) {
            if (op.o === 'append' && typeof op.v === 'string') {
              for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role !== 'system') {
                  messages[i].content += op.v;
                  break;
                }
              }
            }
          }
        }
        continue;
      }

      // Version Checkpoint entries
      if (parsed.v?.message && typeof parsed.c === 'number') {
        const msg = parsed.v.message;
        const role = msg.author?.role;
        if (!role || role === 'system') continue;

        const ct = msg.content?.content_type;
        const parts = msg.content?.parts;

        if (ct === 'model_editable_context') {
          const last = messages[messages.length - 1];
          if (!last || last.role !== role || last.content !== '') {
            messages.push({ role, content: '', timestamp: undefined });
          }
        } else if (ct === 'text' && Array.isArray(parts)) {
          const content = parts.join('');
          const last = messages[messages.length - 1];
          if (last?.role === role && last.content === '') {
            messages[messages.length - 1] = {
              role,
              content,
              timestamp: msg.create_time ? new Date(msg.create_time * 1000).toISOString() : last.timestamp,
            };
          } else if (content || role === 'user') {
            messages.push({
              role,
              content,
              timestamp: msg.create_time ? new Date(msg.create_time * 1000).toISOString() : undefined,
            });
          }
        }
        continue;
      }

      // Bare value delta
      if (parsed.v !== undefined && parsed.o === undefined && parsed.c === undefined) {
        if (typeof parsed.v === 'string') {
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role !== 'system') {
              messages[i].content += parsed.v;
              break;
            }
          }
          continue;
        }
        if (Array.isArray(parsed.v)) {
          for (const op of parsed.v) {
            if (op.o === 'append' && typeof op.v === 'string') {
              for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role !== 'system') {
                  messages[i].content += op.v;
                  break;
                }
              }
            }
          }
          continue;
        }
      }

      // title_generation
      if (parsed.type === 'title_generation' && parsed.title) {
        title = parsed.title;
        continue;
      }

      // Skip input_message / output_message
      if (parsed.type === 'input_message' || parsed.type === 'output_message') continue;
    } catch {
      // Skip unparseable
    }
  }

  // Deduplicate: remove system, tool, empty
  const filtered = messages.filter(m => m.role !== 'system' && m.role !== 'tool' && m.content.length > 0);
  const deduped = [];
  for (const msg of filtered) {
    const prev = deduped[deduped.length - 1];
    if (prev?.role === msg.role) {
      if (msg.content.length >= prev.content.length) {
        deduped[deduped.length - 1] = msg;
      }
    } else {
      deduped.push(msg);
    }
  }

  if (deduped.length === 0) throw new Error('No messages found in SSE');

  return {
    platform: 'chatgpt',
    conversationId: conversationId,
    title: title || deduped[0]?.content.slice(0, 50) || 'Untitled',
    messages: deduped.map(m => ({
      role: m.role === 'user' ? 'user' : m.role === 'assistant' ? 'assistant' : m.role,
      content: m.content,
      timestamp: m.timestamp,
      isComplete: isComplete,
    })),
    createdAt: deduped[0]?.timestamp || new Date().toISOString(),
    updatedAt: deduped[deduped.length - 1]?.timestamp || new Date().toISOString(),
  };
}

async function login() {
  const resp = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: TEST_USER, password: TEST_PASS }),
  });
  if (!resp.ok) throw new Error(`Login failed: ${resp.status}`);
  return resp.json();
}

async function getOrCreateAPIToken(jwt) {
  const listResp = await fetch(`${BACKEND_URL}/api/v1/auth/tokens`, {
    headers: { 'Authorization': `Bearer ${jwt}` },
  });
  if (listResp.ok) {
    const tokens = await listResp.json();
    if (tokens.length > 0) return tokens[0].token;
  }
  const resp = await fetch(`${BACKEND_URL}/api/v1/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
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
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Upload failed: ${resp.status} - ${text}`);
  }
  return resp.json();
}

async function getStats(token) {
  const resp = await fetch(`${BACKEND_URL}/api/v1/stats/overview`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  return resp.json();
}

async function queryConversations(token, conversationId) {
  const resp = await fetch(`${BACKEND_URL}/api/v1/conversations`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const list = data.items || [];
  return list.find(c => c.conversation_id === conversationId) || null;
}

async function queryMessages(token, internalId) {
  const resp = await fetch(`${BACKEND_URL}/api/v1/conversations/${internalId}/messages`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  return resp.json();
}

async function main() {
  console.log('=== ChatGPT Turn (SSE) Capture Test ===\n');

  const rawSSE = readFileSync('./test-data/chatgpt-turn-sse.txt', 'utf-8');
  console.log(`1. Read ${rawSSE.length} bytes of SSE data`);

  const conv = parseSSE(rawSSE, true);
  console.log(`2. Parsed conversation:`);
  console.log(`   Title: ${conv.title}`);
  console.log(`   ID: ${conv.conversationId}`);
  console.log(`   Messages: ${conv.messages.length}`);
  conv.messages.forEach((m, i) => {
    console.log(`     [${i + 1}] ${m.role}: "${m.content.substring(0, 80)}"`);
  });
  console.log();

  // Validate expected output
  const userMsg = conv.messages.find(m => m.role === 'user');
  const assistantMsg = conv.messages.find(m => m.role === 'assistant');

  if (!userMsg) { console.error('   FAIL: No user message found'); process.exit(1); }
  if (!assistantMsg) { console.error('   FAIL: No assistant message found'); process.exit(1); }
  if (!userMsg.content.includes('1+1')) { console.error(`   FAIL: User message wrong: ${userMsg.content}`); process.exit(1); }
  if (assistantMsg.content !== '2') { console.error(`   FAIL: Assistant message wrong: "${assistantMsg.content}" (expected "2")`); process.exit(1); }
  console.log('   ✓ Parsed correctly: user="1+1等于几？只回答数字", assistant="2"');
  console.log();

  console.log('3. Logging in to backend...');
  const { access_token } = await login();
  console.log(`   ✓ Got JWT token`);

  console.log('4. Getting API token...');
  const apiToken = await getOrCreateAPIToken(access_token);
  console.log(`   ✓ API token: ${apiToken.substring(0, 20)}...`);

  const statsBefore = await getStats(apiToken);
  console.log(`5. Stats before: ${statsBefore?.total_conversations || 0} convs, ${statsBefore?.total_messages || 0} msgs`);

  console.log('6. Uploading turn conversation...');
  const uploadResult = await uploadConversation(apiToken, conv);
  console.log(`   ✓ Upload result:`, JSON.stringify(uploadResult));

  console.log('7. Querying to verify...');
  const queried = await queryConversations(apiToken, conv.conversationId);
  if (queried) {
    console.log(`   ✓ Found in database:`);
    console.log(`     Title: ${queried.title}`);
    console.log(`     Platform: ${queried.platform}`);
    console.log(`     Message count: ${queried.message_count}`);

    const msgs = await queryMessages(apiToken, queried.id);
    if (msgs) {
      const msgList = Array.isArray(msgs) ? msgs : msgs.messages || [];
      console.log(`     Messages in DB: ${msgList.length}`);
      msgList.forEach((m, i) => {
        console.log(`       [${i + 1}] ${m.role}: "${m.content?.substring(0, 60)}"`);
      });
    }
  } else {
    console.error('   ✗ Conversation not found');
    process.exit(1);
  }

  const statsAfter = await getStats(apiToken);
  console.log();
  console.log(`8. Stats after: ${statsAfter?.total_conversations || 0} convs, ${statsAfter?.total_messages || 0} msgs`);
  if (statsAfter?.platform_distribution) {
    console.log(`   Platform distribution:`, JSON.stringify(statsAfter.platform_distribution));
  }

  console.log('\n=== Turn Test PASSED ===');
}

main().catch(err => {
  console.error('\nTest FAILED:', err.message);
  process.exit(1);
});
