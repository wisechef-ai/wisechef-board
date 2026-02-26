import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

let chatHistory = [];
let byokNudgeSent = false;

export function createChatSession(_req, res) {
  chatHistory = [];
  byokNudgeSent = false;
  res.json({ ok: true, sessionKey: 'board-chat', history: [] });
}

function checkBYOKNudge() {
  if (byokNudgeSent) return null;
  try {
    // Check if BYOK
    const homeDir = process.env.HOME || '/root';
    const config = JSON.parse(fs.readFileSync(path.join(homeDir, '.openclaw', 'openclaw.json'), 'utf8'));
    const providers = config.providers || {};
    const hasBYOK = Object.values(providers).some(p => p.apiKey);
    if (hasBYOK) return null;

    // Check usage
    const res = execSync('curl -s http://localhost:3333/api/usage-limits', { timeout: 5000, encoding: 'utf8' });
    const limits = JSON.parse(res);
    if (limits.percent >= 50) {
      byokNudgeSent = true;
      return `\n\n---\n💡 **Tip:** You've used ${limits.percent}% of your monthly allowance. Connect your own AI key for **unlimited usage** — go to **AI Provider** in the sidebar.`;
    }
  } catch {}
  return null;
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
    
    let reply = result;
    if (req._usageNote) reply += req._usageNote;
    
    // BYOK nudge (Option C) — one-time at 50% usage
    const nudge = checkBYOKNudge();
    if (nudge) reply += nudge;
    
    res.json({ ok: true, reply, usageInfo: req._usageInfo || null });
  } catch (e) {
    console.error('Chat send failed:', e.message);
    res.json({
      ok: false,
      reply: '⚠️ Agent is warming up after model switch — this takes about 30 seconds. Please try again shortly.',
      error: e.message
    });
  }
}
