import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { WORKSPACE, OPENCLAW_DIR, SOUL_TEMPLATES } from '../config.js';

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

    // Use selected template as base, or default
    const selectedTemplate = SOUL_TEMPLATES.find(t => t.name === answers._template);
    const templateBase = selectedTemplate ? selectedTemplate.content + '\n\n---\n\n' : '';

    const style = answers.style === 'Formal' ? 'professional and to the point'
      : answers.style === 'Casual' ? 'casual, direct, with a touch of humor'
      : 'flexible — formal when needed, casual by default';

    fs.writeFileSync(path.join(WORKSPACE, 'SOUL.md'), templateBase + `# SOUL.md - WiseChef Personal Assistant

I'm a personal AI assistant powered by WiseChef. My communication style: **${style}**.

## How I Work
- I deliver information as: ${answers.reports || 'short and to the point'}
- I'm proactive — I get things done before you ask
- I know your work context and adapt accordingly
- I respect your time — no unnecessary noise

## Your Work
${answers.business || '(to be filled in)'}

## Your Team
${answers.team || 'Solo'}

## Working Hours
${answers.hours || 'Standard'}

## Your Pain Points
${answers.pain || '(to be filled in)'}

## What I Do For You
${answers.automate || 'Automate everything that can be automated'}

## Your Tools
${answers.tools || '(to be filled in)'}

## Fun Fact
${answers.fun || ''}
`);

    fs.writeFileSync(path.join(WORKSPACE, 'USER.md'), `# USER.md

- **Industry:** ${answers.business || '(to be filled in)'}
- **Team:** ${answers.team || 'Solo'}
- **Working hours:** ${answers.hours || 'Standard'}
- **Communication style:** ${answers.style || 'Flexible'}
- **Preferred report format:** ${answers.reports || 'Short and to the point'}
- **Tools:** ${answers.tools || '(to be filled in)'}
- **Pain point:** ${answers.pain || '(to be filled in)'}
- **Fun:** ${answers.fun || ''}
`);

    fs.writeFileSync(path.join(WORKSPACE, 'onboarding-complete.json'),
      JSON.stringify({ completed: new Date().toISOString(), answers }, null, 2));

    res.json({ ok: true });
  } catch (err) {
    console.error('Onboarding error:', err);
    res.status(500).json({ error: err.message });
  }
}

// ────────────────────────────────────────────────────────
// Channel listing
// ────────────────────────────────────────────────────────

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
