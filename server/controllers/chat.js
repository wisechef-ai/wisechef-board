import { execSync } from 'child_process';

let chatHistory = [];

export function createChatSession(_req, res) {
  chatHistory = [];
  res.json({ ok: true, sessionKey: 'board-chat', history: [] });
}

export function sendChatMessage(req, res) {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'No message' });

  chatHistory.push({ role: 'user', content: message, timestamp: Date.now() });

  try {
    // Use openclaw CLI to send message and get response
    const escaped = message.replace(/'/g, "'\\''");
    const result = execSync(
      `echo '${escaped}' | timeout 120 openclaw run --no-stream 2>/dev/null`,
      { timeout: 130000, encoding: 'utf8', maxBuffer: 1024 * 1024 }
    ).trim();

    chatHistory.push({ role: 'assistant', content: result, timestamp: Date.now() });
    res.json({ ok: true, reply: result });
  } catch (e) {
    // Fallback: try openclaw message send
    try {
      const escaped = message.replace(/"/g, '\\"');
      const result = execSync(
        `openclaw run -m "${escaped}" 2>/dev/null`,
        { timeout: 130000, encoding: 'utf8', maxBuffer: 1024 * 1024 }
      ).trim();

      chatHistory.push({ role: 'assistant', content: result, timestamp: Date.now() });
      res.json({ ok: true, reply: result });
    } catch (e2) {
      console.error('Chat send failed:', e2.message);
      res.json({ ok: false, reply: '⚠️ Agent is not responding. Make sure a messaging channel is linked and the gateway is running.', error: e2.message });
    }
  }
}
