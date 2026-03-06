import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { WORKSPACE, OPENCLAW_DIR, AGENT_TYPES_ENABLED } from '../config.js';

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
// Send welcome message after channel is linked and gateway restarted
function sendWelcomeMessage(channel, target) {
  // Poll gateway status until the channel is actually connected, then send
  const MAX_ATTEMPTS = 12; // 12 × 10s = 2 minutes max wait
  const POLL_INTERVAL = 10000;
  let attempt = 0;

  const poll = () => {
    attempt++;
    try {
      const statusOut = execSync('openclaw status 2>&1', { timeout: 15000, encoding: 'utf8' });
      const channelName = channel.charAt(0).toUpperCase() + channel.slice(1);
      const isConnected = statusOut.includes(channelName) && statusOut.includes('OK') && statusOut.includes('linked');
      
      if (!isConnected) {
        if (attempt < MAX_ATTEMPTS) {
          console.log(`[welcome] Channel ${channel} not ready yet (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in 10s...`);
          setTimeout(poll, POLL_INTERVAL);
          return;
        }
        console.log(`[welcome] Channel ${channel} still not ready after ${MAX_ATTEMPTS} attempts, sending anyway...`);
      } else {
        console.log(`[welcome] Channel ${channel} is connected (attempt ${attempt}), sending welcome message...`);
      }
    } catch (e) {
      if (attempt < MAX_ATTEMPTS) {
        console.log(`[welcome] Status check failed (attempt ${attempt}), retrying...`);
        setTimeout(poll, POLL_INTERVAL);
        return;
      }
    }

    // Actually send the message
    try {
      let name = 'there';
      try {
        const answers = JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'onboarding-answers.json'), 'utf8'));
        name = (answers.name || 'there').split(' ')[0];
        name = name.charAt(0).toUpperCase() + name.slice(1);
      } catch {}
      const msg = `Hey ${name}! 👋 I'm your WiseChef AI assistant — Chef. You can message me right here anytime. Ask me anything, give me tasks, or just chat. I'll learn your preferences over time and get better at helping you.\n\nTry sending me something!`;
      const escaped = msg.replace(/'/g, "'\\''");
      const args = ['openclaw', 'message', 'send', '--channel', channel, '-m', `'${escaped}'`];
      if (target) args.push('-t', target);
      execSync(args.join(' '), { timeout: 30000, encoding: 'utf8' });
      console.log(`[welcome] Sent welcome message via ${channel} to ${target || 'default'}`);
    } catch (e) {
      console.error('[welcome] Failed to send welcome message:', e.message);
    }
  };

  // Start polling after initial 5s delay (gateway needs a moment to begin connecting)
  setTimeout(poll, 5000);
}


// On-demand signal-cli installer
let signalCliInstalling = false;
function isSignalCliInstalled() {
  try {
    const paths = ['/usr/local/bin/signal-cli', '/opt/wisechef/bin/signal-cli'];
    const found = paths.some(p => { try { require('fs').accessSync(p, require('fs').constants.X_OK); return true; } catch { return false; } });
    if (found) return true;
    execSync('which signal-cli 2>/dev/null', { timeout: 3000 });
    return true;
  } catch { return false; }
}

async function ensureSignalCli() {
  if (isSignalCliInstalled()) return { ok: true };
  if (signalCliInstalling) return { ok: false, error: 'Signal CLI is currently being installed, please wait...' };
  
  signalCliInstalling = true;
  try {
    console.log('[signal-cli] Installing on demand...');
    const version = execSync(
      'curl -sL -o /dev/null -w "%{url_effective}" https://github.com/AsamK/signal-cli/releases/latest | sed "s/^.*\\/v//"',
      { timeout: 15000, encoding: 'utf8' }
    ).trim();
    console.log(`[signal-cli] Latest version: ${version}`);
    
    execSync(
      `cd /tmp && curl -L -O "https://github.com/AsamK/signal-cli/releases/download/v${version}/signal-cli-${version}-Linux-native.tar.gz" 2>&1`,
      { timeout: 120000 }
    );
    
    // Native build extracts as a single binary or a directory — handle both
    execSync(`cd /tmp && tar xf "signal-cli-${version}-Linux-native.tar.gz" 2>&1`, { timeout: 30000 });
    
    // Find the actual binary
    const findBin = execSync(
      `find /tmp -name "signal-cli" -type f -executable 2>/dev/null || find /opt -name "signal-cli" -not -path "*/usr/*" -type f 2>/dev/null | head -1`,
      { timeout: 5000, encoding: 'utf8' }
    ).trim().split('\n')[0];
    
    if (findBin) {
      execSync(`mkdir -p /opt/wisechef/bin && rm -f /opt/wisechef/bin/signal-cli && cp "${findBin}" /opt/wisechef/bin/signal-cli && chmod +x /opt/wisechef/bin/signal-cli && (ln -sf /opt/wisechef/bin/signal-cli /usr/local/bin/signal-cli 2>/dev/null || true)`, { timeout: 5000 });
    } else {
      // Tar might extract directly to /opt/signal-cli as single file
      const candidates = [
        `/tmp/signal-cli-${version}-Linux-native/bin/signal-cli`,
        `/tmp/signal-cli-${version}-Linux-native/signal-cli`,
        `/tmp/signal-cli`,
        `/opt/signal-cli`,
      ];
      const found = candidates.find(p => { try { fs.accessSync(p, fs.constants.F_OK); return true; } catch { return false; } });
      if (found) {
        execSync(`mkdir -p /opt/wisechef/bin && rm -f /opt/wisechef/bin/signal-cli && cp "${found}" /opt/wisechef/bin/signal-cli && chmod +x /opt/wisechef/bin/signal-cli && (ln -sf /opt/wisechef/bin/signal-cli /usr/local/bin/signal-cli 2>/dev/null || true)`, { timeout: 5000 });
      }
    }
    
    const installed = isSignalCliInstalled();
    console.log(`[signal-cli] Installation ${installed ? 'succeeded' : 'failed'}`);
    return { ok: installed, error: installed ? null : 'Installation completed but binary not found' };
  } catch (e) {
    console.error('[signal-cli] Install failed:', e.message);
    return { ok: false, error: `Installation failed: ${e.message}` };
  } finally {
    signalCliInstalling = false;
  }
}

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

function readOpenclawConfig() {
  try {
    const p = path.join(OPENCLAW_DIR, 'openclaw.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return {}; }
}

function ensureChannelConfig(channel) {
  const configPath = path.join(OPENCLAW_DIR, 'openclaw.json');
  let config = readOpenclawConfig();
  
  // Ensure gateway section exists
  if (!config.gateway) {
    const gatewayToken = process.env.GATEWAY_TOKEN || '';
    config.gateway = { auth: { token: gatewayToken }, mode: 'local' };
  }
  
  if (!config.channels) config.channels = {};
  
  // Add channel if not present
  if (!config.channels[channel]) {
    config.channels[channel] = {};
    fs.mkdirSync(OPENCLAW_DIR, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`Added ${channel} to openclaw.json`);
    
    // Restart gateway to pick up new config
    try { restartGateway(); } catch (e) { console.error('Gateway restart after config:', e.message); }
  }
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

  // Ensure Chef branding in openclaw config
  try {
    const cfgPath = path.join(process.env.HOME || '/root', '.openclaw/openclaw.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    // Set [Chef] response prefix if not already set
    if (!cfg.messages) cfg.messages = {};
    if (!cfg.messages.responsePrefix) cfg.messages.responsePrefix = '[Chef]';
    // Set agent identity name to Chef
    if (!cfg.agents) cfg.agents = {};
    if (!cfg.agents.list) cfg.agents.list = [{ id: 'main', identity: { name: 'Chef' } }];
    else {
      const main = cfg.agents.list.find(a => a.id === 'main');
      if (main && !main.identity?.name) {
        if (!main.identity) main.identity = {};
        main.identity.name = 'Chef';
      }
    }
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error('[branding] Failed to set Chef branding:', e.message);
  }
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
  // Try system-level systemd first (VPS with root service)
  try {
    execSync('systemctl restart openclaw-gateway.service', { timeout: 15000, shell: '/bin/sh' });
    return;
  } catch {}
  
  // Try user-level systemd (VPS with user service)
  try {
    execSync('systemctl --user restart openclaw-gateway.service', {
      env: { ...process.env, XDG_RUNTIME_DIR: `/run/user/${process.getuid?.() || 0}` },
      timeout: 15000,
      shell: '/bin/sh',
    });
    return;
  } catch {}
  
  // Docker container — kill existing gateway and spawn new one
  try { execSync('kill $(cat /tmp/openclaw-gateway.pid 2>/dev/null) 2>/dev/null', { timeout: 5000, shell: '/bin/sh' }); } catch {}
  try { execSync('sleep 1', { timeout: 3000 }); } catch {}
  
  const child = spawn('openclaw', ['gateway', 'run'], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: process.env,
  });
  try { fs.writeFileSync('/tmp/openclaw-gateway.pid', String(child.pid)); } catch {}
  child.unref();
  console.log(`Gateway restarted (PID ${child.pid})`);
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

    // Only write SOUL.md if no agent type has been selected.
    // Agent type selection writes its own SOUL.md + agent-type.json sentinel —
    // overwriting would lose the user's chosen agent personality.
    const agentTypeSentinel = path.join(WORKSPACE, 'agent-type.json');
    if (!fs.existsSync(agentTypeSentinel)) {
      fs.writeFileSync(path.join(WORKSPACE, 'SOUL.md'), soul);
    } else {
      console.log('[onboarding] agent-type.json sentinel found — skipping SOUL.md overwrite');
    }

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

    // When agent type selector is enabled, redirect client to picker after onboarding.
    // The picker works independently of channel linking state.
    const redirect = AGENT_TYPES_ENABLED ? '/select-agent' : '/';
    res.json({ ok: true, redirect });
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

  // Also check channel-linked.json as fallback (signal-cli link doesn't update openclaw status)
  let linkedFile = {};
  try {
    linkedFile = JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'channel-linked.json'), 'utf8'));
  } catch {}

  const config = readOpenclawConfig();
  const result = Object.entries(CHANNELS).map(([key, ch]) => {
    const configured = !!(config.channels?.[key]);
    const keyLower = key.toLowerCase();
    const statusLower = statusOutput.toLowerCase();
    const channelLine = statusLower.split('\n').find(l => l.includes(keyLower)) || '';
    const linkedFromStatus = channelLine.includes('linked') && !channelLine.includes('not linked') && !channelLine.includes('not configured');
    const linkedFromFile = !!(linkedFile[key]?.linkedAt);
    const linked = linkedFromStatus || linkedFromFile;
    const linking = linkingSessions.has(key);
    return {
      id: key, ...ch, configured: configured || linkedFromFile, linked, linking,
      linkingStatus: linking ? linkingSessions.get(key).status : null,
    };
  });

  res.json({ channels: result });
}

// ────────────────────────────────────────────────────────
// Start linking (QR / Signal / token)
// ────────────────────────────────────────────────────────

export async function startLinking(req, res) {
  if (!isOnboarded()) {
    return res.status(403).json({ error: 'onboarding_required' });
  }
  
  const { channel } = req.body;
  if (!CHANNELS[channel]) return res.status(400).json({ error: 'Unknown channel' });
  const ch = CHANNELS[channel];

  // Ensure openclaw.json exists with this channel configured
  ensureChannelConfig(channel);

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
        // Only keep the latest QR block (WhatsApp refreshes QR periodically)
        const lines = buffer.split('\n');
        const qrLines = [];
        for (let i = lines.length - 1; i >= 0; i--) {
          if (lines[i].includes('▄') || lines[i].includes('█') || lines[i].includes('▀')) {
            qrLines.unshift(lines[i]);
          } else if (qrLines.length > 0) break;
        }
        session.qrRaw = qrLines.join('\n');
        session.status = 'qr_ready';
      }
      if (text.toLowerCase().includes('connected') || text.toLowerCase().includes('success')) {
        session.status = 'connected';
        saveChannelLink(channel);
        try { restartGateway(); } catch (e) { session.logs.push('Gateway restart error: ' + e.message); }
        // Get the target for welcome message (phone from config or linking session)
        let welcomeTarget;
        try {
          const cfg = JSON.parse(fs.readFileSync(path.join(process.env.HOME || '/root', '.openclaw/openclaw.json'), 'utf8'));
          welcomeTarget = cfg.channels?.[channel]?.account || cfg.channels?.[channel]?.allowFrom?.[0];
        } catch {}
        sendWelcomeMessage(channel, welcomeTarget);
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
    // Ensure signal-cli is installed on demand
    const installResult = await ensureSignalCli();
    if (!installResult.ok) {
      return res.json({ ok: false, error: installResult.error });
    }

    // Use signal-cli link directly (openclaw channels login doesn't support Signal)
    const session = {
      process: null, qrData: null, qrRaw: null, qrUri: null,
      status: 'waiting', error: null, startedAt: Date.now(), logs: [],
    };

    const signalCliBin = ['/usr/local/bin/signal-cli', '/opt/wisechef/bin/signal-cli'].find(p => { try { require('fs').accessSync(p, require('fs').constants.X_OK); return true; } catch { return false; } }) || 'signal-cli';
  const proc = spawn(signalCliBin, ['link', '-n', 'WiseChef'], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    session.process = proc;

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      session.logs.push(text);
      // signal-cli link outputs the sgnl:// URI on stdout
      const match = text.match(/(sgnl:\/\/[^\s]+)/);
      if (match) {
        session.qrUri = match[1];
        session.status = 'qr_ready';
      }
    });

    proc.stderr.on('data', (data) => { session.logs.push(data.toString()); });
    proc.on('exit', (code) => {
      if (code === 0) {
        // signal-cli link exits 0 when successfully linked
        session.status = 'connected';
        // Configure openclaw for signal
        try {
          // Get the linked account number from signal-cli
          const accounts = execSync('signal-cli -o json listAccounts 2>/dev/null', { encoding: 'utf8', timeout: 10000 });
          const parsed = JSON.parse(accounts);
          const account = Array.isArray(parsed) ? parsed[0]?.number : parsed?.number;
          if (account) {
            // Write account directly to avoid shell escaping issues with + in phone numbers
            const cfgPath = path.join(process.env.HOME || '/root', '.openclaw/openclaw.json');
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            if (!cfg.channels) cfg.channels = {};
            if (!cfg.channels.signal) cfg.channels.signal = {};
            cfg.channels.signal.account = account;
            fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

          }
        } catch {}
        saveChannelLink(channel);
        try { restartGateway(); } catch (e) { session.logs.push('Gateway restart error: ' + e.message); }
        // Get account for welcome message target
        let welcomeTarget;
        try {
          const cfg = JSON.parse(fs.readFileSync(path.join(process.env.HOME || '/root', '.openclaw/openclaw.json'), 'utf8'));
          welcomeTarget = cfg.channels?.[channel]?.account || cfg.channels?.[channel]?.allowFrom?.[0];
        } catch {}
        sendWelcomeMessage(channel, welcomeTarget);
      } else {
        if (session.status !== 'timeout') {
          session.status = 'failed';
          session.error = `Process exited with code ${code}`;
        }
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

  // Ensure channel exists in openclaw.json first
  ensureChannelConfig(channel);

  try {
    const args = ['openclaw', 'channels', 'add', '--channel', channel];
    if (channel === 'telegram' || channel === 'discord') {
      args.push('--token', token || botToken);
    } else if (channel === 'slack') {
      if (botToken) args.push('--bot-token', botToken);
      if (appToken) args.push('--app-token', appToken);
    }

    execSync(args.join(' '), { timeout: 15000 });
    saveChannelLink(channel);
    restartGateway();
    // Send welcome message after gateway restarts
    sendWelcomeMessage(channel);
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
    // Try system service first, then user service
    let status;
    try {
      status = execSync('systemctl is-active openclaw-gateway.service 2>&1', { timeout: 5000 }).toString().trim();
    } catch {
      try {
        status = execSync('systemctl --user is-active openclaw-gateway.service 2>&1', {
          env: { ...process.env, XDG_RUNTIME_DIR: `/run/user/${process.getuid?.() || 0}` },
          timeout: 5000,
        }).toString().trim();
      } catch (e2) {
        status = e2.stdout?.toString().trim() || 'unknown';
      }
    }
    res.json({ status, token: getGatewayToken() });
  } catch (err) {
    res.json({ status: err.stdout?.toString().trim() || 'unknown', token: getGatewayToken() });
  }
}
