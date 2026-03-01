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
    // Check provider keys from separate file + env vars
    let provKeys = {};
    try { provKeys = JSON.parse(fs.readFileSync(path.join(homeDir, '.openclaw', 'provider-keys.json'), 'utf8')); } catch {}
    const hasBYOK = Object.values(provKeys).some(p => p.apiKey)
      || !!process.env.GEMINI_API_KEY || !!process.env.OPENAI_API_KEY || !!process.env.OPENROUTER_API_KEY;
    if (hasBYOK) return null;

    // Check usage
    const res = execSync('curl -s http://localhost:3333/api/usage-limits', { timeout: 5000, encoding: 'utf8' });
    const limits = JSON.parse(res);
    if (limits.percent >= 50) {
      byokNudgeSent = true;
      return `\n\n---\n💡 **Tip:** Your battery is at ${100 - (limits.battery?.percent || limits.percent)}% — it recharges when you're idle. Connect your own AI key for **unlimited usage** — go to **AI Provider** in the sidebar.`;
    }
  } catch {}
  return null;
}

function runChatAgentCommand(escaped) {
  return execSync(
    `openclaw agent -m '${escaped}' --session-id board-chat`,
    { timeout: 120000, encoding: 'utf8', maxBuffer: 1024 * 1024 }
  ).trim();
}

function logChatError(prefix, error) {
  console.error(prefix, {
    message: error.message,
    status: error.status ?? null,
    signal: error.signal ?? null,
    stdout: error.stdout?.toString?.().trim() || '',
    stderr: error.stderr?.toString?.().trim() || '',
  });
}

export function sendChatMessage(req, res) {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'No message' });

  chatHistory.push({ role: 'user', content: message, timestamp: Date.now() });

  try {
    const escaped = message.replace(/'/g, "'\\''").replace(/\\/g, '\\\\');
    let result;

    try {
      result = runChatAgentCommand(escaped);
    } catch (firstError) {
      logChatError('Chat send failed on first attempt:', firstError);
      execSync('sleep 3', { timeout: 4000 });
      result = runChatAgentCommand(escaped);
    }

    chatHistory.push({ role: 'assistant', content: result, timestamp: Date.now() });
    
    let reply = result;
    if (req._usageNote) reply += req._usageNote;
    
    // BYOK nudge (Option C) — one-time at 50% usage
    const nudge = checkBYOKNudge();
    if (nudge) reply += nudge;
    
    res.json({ ok: true, reply, usageInfo: req._usageInfo || null });
  } catch (e) {
    logChatError('Chat send failed after retry:', e);
    res.json({
      ok: false,
      reply: '⚠️ Agent is warming up after model switch — this takes about 30 seconds. Please try again shortly.',
      error: e.message
    });
  }
}
