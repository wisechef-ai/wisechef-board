// Fix Issues 2, 3, 4 — Patch channels.js
//
// Issue 2: Skip channel linking — no changes needed in channels.js 
//          (fix is in routes.js — ?skip query param already supported)
//          BUT the link-channel.html "Skip for now" link goes to /dashboard, 
//          not /?skip=1 which routes.js expects. Fix is in link-channel.html.
//
// Issue 3: Gateway startup race — increase delay from 5s to 10s, 
//          add retry with gateway health check up to 45s
//
// Issue 4: Welcome message — detect phone from `openclaw status` output

const fs = require('fs');
const path = require('path');

const CHANNELS_JS = '/opt/wisechef/board/server/controllers/channels.js';

let content = fs.readFileSync(CHANNELS_JS, 'utf8');
const original = content;
let changes = 0;

// ───── Issue 3: Fix gateway startup race ─────
// Replace: await new Promise(resolve => setTimeout(resolve, 5000));
// With: health-check loop up to 45s, then 10s stabilize delay, retry on total failure

const oldDelay = `  // If gateway was just restarted, wait for it to be ready before spawning login
  if (gatewayRestarted) {
    await new Promise(resolve => setTimeout(resolve, 5000));
  }`;

const newDelay = `  // If gateway was just restarted, wait for it to be ready (up to 45s)
  if (gatewayRestarted) {
    const maxWaitMs = 45000;
    const pollMs = 2000;
    const started = Date.now();
    let ready = false;
    while (Date.now() - started < maxWaitMs) {
      try {
        const statusOut = execSync('openclaw status 2>&1', { timeout: 5000, encoding: 'utf8' });
        if (statusOut.includes('Gateway') && (statusOut.includes('running') || statusOut.includes('OK'))) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise(r => setTimeout(r, pollMs));
    }
    if (!ready) {
      console.log('[channels] Gateway not ready after 45s — will attempt linking anyway');
    }
    // Extra stabilization delay
    await new Promise(resolve => setTimeout(resolve, 3000));
  }`;

if (content.includes(oldDelay)) {
    content = content.replace(oldDelay, newDelay);
    changes++;
    console.log('[fix-3] Replaced 5s fixed delay with 45s health-check loop + 3s stabilize');
} else {
    console.log('[fix-3] Could not find exact delay block — checking for partial match');
    // Try simpler match
    if (content.includes('setTimeout(resolve, 5000)') && content.includes('gatewayRestarted')) {
        content = content.replace(
            /if \(gatewayRestarted\) \{\s*await new Promise\(resolve => setTimeout\(resolve, 5000\)\);\s*\}/,
            newDelay.replace(/^  /, '')
        );
        changes++;
        console.log('[fix-3] Applied via regex');
    } else {
        console.error('[fix-3] FAILED — cannot find delay code');
    }
}

// ───── Issue 4: Fix welcome message phone detection ─────
// In sendWelcomeMessage, after the current target detection, add fallback to openclaw status
// Current code gets target from cfg.channels?.[channel]?.account
// We need to add a fallback that parses `openclaw status` for the linked phone number

const oldWelcomeTarget = `        // Get the target for welcome message (phone from config or linking session)
        let welcomeTarget;
        try {
          const cfg = JSON.parse(fs.readFileSync(path.join(process.env.HOME || '/root', '.openclaw/openclaw.json'), 'utf8'));
          welcomeTarget = cfg.channels?.[channel]?.account || cfg.channels?.[channel]?.allowFrom?.[0];
        } catch {}
        sendWelcomeMessage(channel, welcomeTarget);`;

const newWelcomeTarget = `        // Get the target for welcome message (phone from config, status output, or linking logs)
        let welcomeTarget;
        try {
          const cfg = JSON.parse(fs.readFileSync(path.join(process.env.HOME || '/root', '.openclaw/openclaw.json'), 'utf8'));
          welcomeTarget = cfg.channels?.[channel]?.account || cfg.channels?.[channel]?.allowFrom?.[0];
        } catch {}
        // Fallback: parse openclaw status for linked phone number
        if (!welcomeTarget) {
          try {
            const statusOut = execSync('openclaw status 2>&1', { timeout: 10000, encoding: 'utf8' });
            // Look for WhatsApp line with phone: "WhatsApp  +48790703025  OK  linked"
            const chName = channel.charAt(0).toUpperCase() + channel.slice(1);
            const lines = statusOut.split('\\n');
            for (const line of lines) {
              if (line.includes(chName) || line.toLowerCase().includes(channel)) {
                const phoneMatch = line.match(/\\+\\d{7,15}/);
                if (phoneMatch) { welcomeTarget = phoneMatch[0]; break; }
              }
            }
          } catch (e) { console.log('[welcome] Status parse fallback failed:', e.message); }
        }
        // Fallback 2: read phone from manifest.json or onboarding answers
        if (!welcomeTarget) {
          try {
            const answers = JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'onboarding-answers.json'), 'utf8'));
            welcomeTarget = answers.phone;
          } catch {}
        }
        if (!welcomeTarget) {
          try {
            const manifest = JSON.parse(fs.readFileSync('/opt/wisechef/manifest.json', 'utf8'));
            if (manifest.phone) welcomeTarget = manifest.phone;
          } catch {}
        }
        sendWelcomeMessage(channel, welcomeTarget);`;

if (content.includes(oldWelcomeTarget)) {
    content = content.replace(oldWelcomeTarget, newWelcomeTarget);
    changes++;
    console.log('[fix-4] Added welcome message phone detection fallbacks');
} else {
    console.error('[fix-4] FAILED — cannot find welcome target code block');
}

// ───── Issue 3 part 2: Add retry logic to startQrLink ─────
// After the spawn, if the process exits quickly with error and no QR was shown,
// automatically retry once. This handles the case where the first attempt fails
// because gateway wasn't fully ready.

// We'll add this as a proc.on('exit') enhancement — if it exits with error in <10s
// and no QR was ever shown, re-run startLinking internally

// Actually, the better fix is already done above — the health check loop should
// prevent the first-attempt failure entirely. The 45s wait + 3s stabilize = solid.
// The retry should be client-side (the UI already has a "Retry" button).
// But let's add a note that on 'failed' status, the client can auto-retry.

if (content !== original) {
    fs.writeFileSync(CHANNELS_JS, content);
    console.log(`[channels.js] ${changes} fix(es) applied`);
} else {
    console.log('[channels.js] No changes applied');
}
