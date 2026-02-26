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
    const escaped = message.replace(/'/g, "'\\''").replace(/\\/g, '\\\\');
    const result = execSync(
      `openclaw agent -m '${escaped}' --session-id board-chat 2>/dev/null`,
      { timeout: 120000, encoding: 'utf8', maxBuffer: 1024 * 1024 }
    ).trim();

    chatHistory.push({ role: 'assistant', content: result, timestamp: Date.now() });
    const reply = req._usageNote ? result + req._usageNote : result;
    res.json({ ok: true, reply, usageInfo: req._usageInfo || null });
  } catch (e) {
    console.error('Chat send failed:', e.message);
    res.json({
      ok: false,
      reply: '⚠️ Agent is not responding. The gateway may be restarting — try again in a few seconds.',
      error: e.message
    });
  }
}
