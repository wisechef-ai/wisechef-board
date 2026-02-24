import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { WORKSPACE, OPENCLAW_DIR } from '../config.js';

// ────────────────────────────────────────────────────────
// Supported channels (Linux VM — no iMessage)
// ────────────────────────────────────────────────────────

const CHANNELS = {
  whatsapp:  { name: 'WhatsApp',  icon: '📱', linkType: 'qr',    description: 'Personal WhatsApp via QR code scan' },
  telegram:  { name: 'Telegram',  icon: '✈️', linkType: 'token', description: 'Telegram Bot via BotFather token' },
  signal:    { name: 'Signal',    icon: '🔒', linkType: 'signal-qr', description: 'Signal messenger — link as secondary device' },
  discord:   { name: 'Discord',   icon: '🎮', linkType: 'token', description: 'Discord Bot via bot token' },
  slack:     { name: 'Slack',     icon: '💼', linkType: 'token', description: 'Slack workspace via app tokens' },
};

// Active linking sessions (in-memory)
const linkingSessions = new Map();

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

function readOpenclawConfig() {
  try {
    const p = path.join(OPENCLAW_DIR, 'openclaw.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return {}; }
}

function getGatewayToken() {
  return readOpenclawConfig()?.gateway?.auth?.token || '';
}

export function isOnboarded() {
  return fs.existsSync(path.join(WORKSPACE, 'onboarding-complete.json'));
}

export function hasLinkedChannel() {
  return fs.existsSync(path.join(WORKSPACE, 'channel-linked.json'));
}

function saveChannelLink(channel) {
  const file = path.join(WORKSPACE, 'channel-linked.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  data[channel] = { linkedAt: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function removeChannelLink(channel) {
  const file = path.join(WORKSPACE, 'channel-linked.json');
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete data[channel];
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch {}
}

function restartGateway() {
  execSync('systemctl --user restart openclaw-gateway.service', {
    env: { ...process.env, XDG_RUNTIME_DIR: '/run/user/0' },
    timeout: 15000,
  });
}

// ────────────────────────────────────────────────────────
// Onboarding
// ────────────────────────────────────────────────────────

export function getOnboardingStatus(_req, res) {
  res.json({ onboarded: isOnboarded(), channelLinked: hasLinkedChannel() });
}

export function completeOnboarding(req, res) {
  try {
    const { answers } = req.body;
    if (!answers || typeof answers !== 'object')
      return res.status(400).json({ error: 'Missing answers' });

    fs.mkdirSync(WORKSPACE, { recursive: true });
    fs.writeFileSync(path.join(WORKSPACE, 'onboarding-answers.json'), JSON.stringify(answers, null, 2));

    const a = answers;
    const name = a.name || 'User';
    const role = a.role || 'professional';
    const org = a.organisation || 'their organisation';
    const style = a.style || 'flexible';
    const channels = Array.isArray(a.channels) ? a.channels.join(', ') : (a.channels || 'not specified');

    const styleGuidance =
      style.includes('Direct') ? 'Be brief and to the point. No filler, no fluff. Lead with the answer.' :
      style.includes('Warm') ? 'Be supportive and encouraging. Use a conversational tone. Show you care about outcomes.' :
      style.includes('Technical') ? 'Be precise. Use correct terminology. Include code examples and structured data when relevant.' :
      style.includes('Playful') ? 'Keep it light and fun. Use emoji naturally. Be witty but always helpful.' :
      'Adapt your tone to the situation — formal for business, casual for daily check-ins.';

    // Generate rich SOUL.md
    const soul = `# SOUL.md — ${name}'s WiseChef Assistant

## Identity
You are a personal AI assistant for **${name}**.
${name} works as **${role}** at **${org}**.

## Daily Context
${a.activities || '(to be filled in)'}

## Goals & Priorities
${a.goals || '(to be filled in)'}

### What an Ideal Week Looks Like
${a.ideal_week || '(to be filled in)'}

## Friction & Pain Points

### Time Wasters to Eliminate
${a.time_wasters || '(to be filled in)'}

### Things That Fall Through the Cracks
${a.cracks || '(to be filled in)'}

## Communication Preferences
- **Style:** ${style}
- **Information format:** ${a.reports || 'concise'}
- **Language:** ${a.language || 'English'}
- ${styleGuidance}
- When delivering updates, lead with what changed and what needs attention.
- Never send empty check-ins. Every message should carry value.

## Channels & Availability
- **Active channels:** ${channels}
- **Primary channel:** ${a.primary_channel || 'not set'}
- **Working hours:** ${a.working_hours || 'standard business hours'}
- Outside working hours, batch non-urgent updates for the next morning.

## Operating Principles
1. **Be proactive** — anticipate needs before being asked. If you see a pattern, act on it.
2. **Track commitments** — follow up on promises, deadlines, and pending items automatically.
3. **Respect their time** — no noise, no unnecessary messages, no "just checking in."
4. **Flag risks early** — if something is off track, say so immediately with a suggested fix.
5. **Learn and adapt** — notice preferences, patterns, and recurring tasks. Get better over time.
6. **Own the context** — remember past conversations, decisions, and stated preferences.
7. **Be honest** — if you don't know something or can't do it, say so. Never fabricate.

## Automation Preferences
- Automate repetitive tasks without asking each time once a pattern is established.
- For new or risky actions, confirm before executing.
- Provide daily briefs if there are pending items or upcoming deadlines.
- Summarise long threads and documents when asked.
`;

    fs.writeFileSync(path.join(WORKSPACE, 'SOUL.md'), soul);

    // Generate MEMORY.md stub
    const memory = `# MEMORY.md — ${name}

## Profile
- **Name:** ${name}
- **Role:** ${role}
- **Organisation:** ${org}
- **Communication style:** ${style}
- **Primary channel:** ${a.primary_channel || 'not set'}
- **Working hours:** ${a.working_hours || 'standard'}
- **Language:** ${a.language || 'English'}

## Goals
${a.goals || '(to be filled in)'}

## Key Friction Points
${a.time_wasters || '(to be filled in)'}

## Decisions & Preferences
- (Will be populated as the assistant learns)

## Important Dates & Deadlines
- (Will be populated as items are tracked)
`;

    fs.writeFileSync(path.join(WORKSPACE, 'MEMORY.md'), memory);

    // Keep USER.md for backward compat
    fs.writeFileSync(path.join(WORKSPACE, 'USER.md'), `# USER.md

- **Name:** ${name}
- **Role:** ${role}
- **Organisation:** ${org}
- **Communication style:** ${style}
- **Preferred report format:** ${a.reports || 'concise'}
- **Channels:** ${channels}
- **Primary channel:** ${a.primary_channel || 'not set'}
- **Working hours:** ${a.working_hours || 'standard'}
- **Language:** ${a.language || 'English'}
`);

    fs.writeFileSync(path.join(WORKSPACE, 'onboarding-complete.json'),
      JSON.stringify({ completed: new Date().toISOString(), answers }, null, 2));

    res.json({ ok: true });
  } catch (e) {
    console.error('Onboarding error:', e);
    res.status(500).json({ error: 'Onboarding failed' });
  }
}

export function listChannels(_req, res) {
  let statusOutput = '';
  try {
    statusOutput = execSync('openclaw channels list 2>&1', { timeout: 10000 }).toString();
  } catch (e) {
    statusOutput = e.stdout?.toString() || '';
  }

  const config = readOpenclawConfig();
  const result = Object.entries(CHANNELS).map(([key, ch]) => {
    const configured = !!(config.channels?.[key]);
    const linked = statusOutput.toLowerCase().includes(`${key}`) &&
                   !statusOutput.toLowerCase().includes(`${key} default: not linked`);
    const linking = linkingSessions.has(key);
    return {
      id: key, ...ch, configured, linked, linking,
      linkingStatus: linking ? linkingSessions.get(key).status : null,
    };
  });

  res.json({ channels: result });
}

// ────────────────────────────────────────────────────────
// Start linking (QR / Signal / token)
// ────────────────────────────────────────────────────────

export function startLinking(req, res) {
  if (!isOnboarded()) {
    return res.status(403).json({ error: 'onboarding_required' });
  }
  
  const { channel } = req.body;
  if (!CHANNELS[channel]) return res.status(400).json({ error: 'Unknown channel' });
  const ch = CHANNELS[channel];

  // Kill existing session
  if (linkingSessions.has(channel)) {
    try { linkingSessions.get(channel).process?.kill(); } catch {}
    linkingSessions.delete(channel);
  }

  if (ch.linkType === 'qr') {
    const session = {
      process: null, qrData: null, qrRaw: null, qrUri: null,
      status: 'waiting', error: null, startedAt: Date.now(), logs: []
    };

    const proc = spawn('openclaw', ['channels', 'login', '--channel', channel, '--verbose'], {
      env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    session.process = proc;

    let buffer = '';
    proc.stdout.on('data', (data) => {
      const text = data.toString();
      buffer += text;
      session.logs.push(text);
      if (text.includes('▄') || text.includes('█')) {
        session.qrRaw = buffer;
        session.status = 'qr_ready';
      }
      if (text.toLowerCase().includes('connected') || text.toLowerCase().includes('success')) {
        session.status = 'connected';
        saveChannelLink(channel);
        try { restartGateway(); } catch (e) { session.logs.push('Gateway restart error: ' + e.message); }
      }
    });

    proc.stderr.on('data', (data) => { session.logs.push(data.toString()); });
    proc.on('exit', (code) => {
      if (session.status === 'connected') return;
      if (code !== 0) { session.status = 'failed'; session.error = `Process exited with code ${code}`; }
    });

    setTimeout(() => {
      if (session.status === 'waiting' || session.status === 'qr_ready') {
        session.status = 'timeout';
        try { proc.kill(); } catch {}
      }
    }, 180000);

    linkingSessions.set(channel, session);
    res.json({ ok: true, status: 'waiting', linkType: 'qr' });

  } else if (ch.linkType === 'signal-qr') {
    const session = {
      process: null, qrUri: null, qrRaw: null,
      status: 'waiting', error: null, startedAt: Date.now(), logs: [],
      signalAccount: null,
    };

    const proc = spawn('signal-cli', ['link', '-n', 'WiseChef'], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    session.process = proc;

    proc.stdout.on('data', (data) => {
      const text = data.toString().trim();
      session.logs.push(text);
      if (text.startsWith('sgnl://')) {
        session.qrUri = text;
        session.status = 'qr_ready';
      }
      if (text.startsWith('+') || text.includes('Associated with')) {
        session.signalAccount = text.match(/\+\d+/)?.[0];
        session.status = 'connected';
        if (session.signalAccount) {
          try {
            execSync(`openclaw channels add --channel signal --signal-number "${session.signalAccount}" --cli-path signal-cli 2>&1`, { timeout: 10000 });
            execSync(`openclaw config set channels.signal.dmPolicy "allowlist" 2>&1`, { timeout: 5000 });
          } catch (e) { session.logs.push('Config error: ' + e.message); }
        }
        saveChannelLink(channel);
        try { restartGateway(); } catch (e) { session.logs.push('Gateway restart error: ' + e.message); }
      }
    });

    proc.stderr.on('data', (data) => { session.logs.push(data.toString()); });
    proc.on('exit', (code) => {
      if (session.status === 'connected') return;
      if (code !== 0 && session.status !== 'qr_ready') {
        session.status = 'failed';
        session.error = `signal-cli exited with code ${code}. Is signal-cli installed?`;
      }
    });

    setTimeout(() => {
      if (session.status === 'waiting' || session.status === 'qr_ready') {
        session.status = 'timeout';
        try { proc.kill(); } catch {}
      }
    }, 180000);

    linkingSessions.set(channel, session);
    res.json({ ok: true, status: 'waiting', linkType: 'signal-qr' });

  } else {
    res.json({ ok: true, linkType: 'token', channel });
  }
}

// ────────────────────────────────────────────────────────
// QR polling
// ────────────────────────────────────────────────────────

export function getQrStatus(req, res) {
  const session = linkingSessions.get(req.params.channel);
  if (!session) return res.status(404).json({ error: 'No active linking session' });
  res.json({
    status: session.status, qrRaw: session.qrRaw, qrUri: session.qrUri,
    error: session.error, logs: session.logs.slice(-5),
  });
}

// ────────────────────────────────────────────────────────
// Submit token
// ────────────────────────────────────────────────────────

export function submitToken(req, res) {
  const { channel, token, botToken, appToken } = req.body;
  if (!CHANNELS[channel]) return res.status(400).json({ error: 'Unknown channel' });

  try {
    const args = ['channels', 'add', '--channel', channel];
    if (channel === 'telegram' || channel === 'discord') {
      args.push('--token', token || botToken);
    } else if (channel === 'slack') {
      if (botToken) args.push('--bot-token', botToken);
      if (appToken) args.push('--app-token', appToken);
    }

    execSync(args.join(' '), { timeout: 15000 });
    saveChannelLink(channel);
    restartGateway();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ────────────────────────────────────────────────────────
// Unlink channel
// ────────────────────────────────────────────────────────

export function unlinkChannel(req, res) {
  const { channel } = req.params;
  try {
    try { execSync(`openclaw channels logout --channel ${channel} 2>&1`, { timeout: 15000 }); } catch {}
    try { execSync(`openclaw channels remove --channel ${channel} --delete 2>&1`, { timeout: 10000 }); } catch {}
    removeChannelLink(channel);
    restartGateway();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ────────────────────────────────────────────────────────
// Gateway management
// ────────────────────────────────────────────────────────

export function gatewayRestart(_req, res) {
  try { restartGateway(); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
}

export function gatewayStatus(_req, res) {
  try {
    const status = execSync('systemctl --user is-active openclaw-gateway.service 2>&1', {
      env: { ...process.env, XDG_RUNTIME_DIR: '/run/user/0' },
      timeout: 5000,
    }).toString().trim();
    res.json({ status, token: getGatewayToken() });
  } catch (err) {
    res.json({ status: err.stdout?.toString().trim() || 'unknown', token: getGatewayToken() });
  }
}
