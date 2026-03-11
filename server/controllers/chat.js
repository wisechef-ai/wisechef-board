import fs from 'fs';
import path from 'path';
import http from 'http';

// Chat controller — proxies to OpenClaw gateway's OpenAI-compatible endpoint
// POST /v1/chat/completions (must be enabled in openclaw.json)

const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || '18789', 10);
const GATEWAY_HOST = '127.0.0.1';

function getGatewayToken() {
  try {
    const cfg = JSON.parse(fs.readFileSync(
      path.join(process.env.HOME || '/root', '.openclaw/openclaw.json'), 'utf8'
    ));
    return cfg.gateway?.auth?.token || process.env.GATEWAY_TOKEN || '';
  } catch { return process.env.GATEWAY_TOKEN || ''; }
}

function gatewayCall(method, apiPath, body, timeout = 120000) {
  const token = getGatewayToken();
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: GATEWAY_HOST,
      port: GATEWAY_PORT,
      path: apiPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      timeout,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Gateway timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

// In-memory session store (per-container, resets on restart)
const sessions = new Map();

// POST /api/chat/session — create or resume a chat session
export async function createChatSession(req, res) {
  const sessionId = 'dashboard-' + Date.now().toString(36);
  sessions.set(sessionId, {
    messages: [],
    createdAt: Date.now(),
  });
  return res.json({ ok: true, sessionKey: sessionId, history: [] });
}

// POST /api/chat/send — send a message and get a reply
export async function sendChatMessage(req, res) {
  const { message, sessionKey } = req.body;
  if (!message) return res.status(400).json({ ok: false, error: 'Message required' });

  // Get or create session
  let session = sessions.get(sessionKey);
  if (!session) {
    session = { messages: [], createdAt: Date.now() };
    sessions.set(sessionKey || 'default', session);
  }

  // Add user message to history
  session.messages.push({ role: 'user', content: message });

  try {
    // Call OpenClaw gateway's OpenAI-compatible endpoint
    const result = await gatewayCall('POST', '/v1/chat/completions', {
      model: 'openclaw:main',
      messages: session.messages.slice(-20), // Keep last 20 messages for context
      stream: false,
    }, 120000);

    if (result.status === 200 && result.data?.choices?.[0]?.message?.content) {
      const reply = result.data.choices[0].message.content;
      session.messages.push({ role: 'assistant', content: reply });
      return res.json({ ok: true, reply });
    }

    // If the completions endpoint isn't enabled, return helpful error
    if (result.status === 404) {
      return res.json({
        ok: false,
        error: 'Chat endpoint not enabled. The gateway needs gateway.http.endpoints.chatCompletions.enabled=true in openclaw.json',
      });
    }

    console.error('[chat] Gateway response:', result.status, JSON.stringify(result.data).slice(0, 200));
    return res.json({ ok: false, error: 'Agent did not respond (status: ' + result.status + ')' });
  } catch (e) {
    console.error('[chat] Send failed:', e.message);
    return res.json({ ok: false, error: e.message });
  }
}
