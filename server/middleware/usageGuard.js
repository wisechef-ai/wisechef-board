import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// ═══════════════════════════════════════════════════════════════
// BATTERY USAGE SYSTEM — "Recharging" credits model
// ═══════════════════════════════════════════════════════════════
//
// Instead of a hard monthly cap that resets on the 1st:
//   - Each plan has a battery (max credits)
//   - Battery drains with each API call (1 credit = 1 request)
//   - Battery recharges passively over time when not in use
//   - Heavy users drain it, casual users always have full charge
//   - BYOK users bypass entirely (unlimited)
//
// Plans:
//   starter:  100 credits max, recharge 4/hour  (~full in 25h idle)
//   pro:      500 credits max, recharge 20/hour (~full in 25h idle)
//   enterprise: 2000 credits max, recharge 80/hour
//
// Promo: first 40 users get lifetime Pro upgrade after beta
// ═══════════════════════════════════════════════════════════════

const PLANS = {
  starter:    { maxCredits: 100,  rechargePerHour: 4   },
  pro:        { maxCredits: 500,  rechargePerHour: 20  },
  enterprise: { maxCredits: 2000, rechargePerHour: 80  },
};


// BETA PROMO: first 39 users get lifetime Pro
const BETA_PROMO_LIMIT = 39;

const DOWNGRADE_THRESHOLD = 0.1;  // 10% remaining → switch to cheaper model
const DOWNGRADE_MODEL = 'google/gemini-2.5-flash';

// Battery state file
const BATTERY_FILE = path.join(process.env.HOME || '/root', '.openclaw', 'battery.json');

function readBattery() {
  try {
    return JSON.parse(fs.readFileSync(BATTERY_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function writeBattery(state) {
  const dir = path.dirname(BATTERY_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(BATTERY_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function getPlan() {
  // BETA PROMO: first 39 users get lifetime Pro
  const userNumber = parseInt(process.env.WISECHEF_USER_NUMBER || '0', 10);
  if (userNumber > 0 && userNumber <= BETA_PROMO_LIMIT) {
    return 'pro';  // lifetime Pro for beta users
  }

  // Check manifest (Docker containers)
  const manifestPaths = [
    '/opt/wisechef/manifest.json',
    path.join(process.env.WORKSPACE_DIR || '/opt/wisechef/clawd', 'manifest.json'),
  ];
  for (const p of manifestPaths) {
    try {
      const manifest = JSON.parse(fs.readFileSync(p, 'utf8'));
      return manifest.plan || 'starter';
    } catch {}
  }
  if (process.env.WISECHEF_PLAN) return process.env.WISECHEF_PLAN;
  return 'starter';
}

function isBYOK() {
  const homeDir = process.env.HOME || '/root';
  try {
    // Check provider-keys.json
    let provKeys = {};
    try { provKeys = JSON.parse(fs.readFileSync(path.join(homeDir, '.openclaw', 'provider-keys.json'), 'utf8')); } catch {}
    for (const [, prov] of Object.entries(provKeys)) {
      if (prov.apiKey && !prov.apiKey.startsWith('wisechef-')) return true;
    }
    // Check env vars
    if (process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY) return true;
  } catch {}
  return false;
}

/**
 * Get current battery level with passive recharge applied
 */
function getBatteryState() {
  const plan = getPlan();
  const config = PLANS[plan] || PLANS.starter;
  
  let state = readBattery();
  const now = Date.now();
  
  if (!state) {
    // First run: full battery
    state = {
      credits: config.maxCredits,
      maxCredits: config.maxCredits,
      plan,
      lastUpdated: now,
      totalUsed: 0,  // lifetime counter for analytics
    };
    writeBattery(state);
    return state;
  }
  
  // Plan upgrade: adjust max credits if plan changed
  if (state.plan !== plan) {
    state.maxCredits = config.maxCredits;
    state.plan = plan;
  }
  
  // Apply passive recharge since last update
  const hoursSinceUpdate = (now - state.lastUpdated) / (1000 * 60 * 60);
  const rechargeAmount = Math.floor(hoursSinceUpdate * config.rechargePerHour);
  
  if (rechargeAmount > 0) {
    state.credits = Math.min(state.maxCredits, state.credits + rechargeAmount);
    state.lastUpdated = now;
    writeBattery(state);
  }
  
  return state;
}

/**
 * Consume 1 credit from battery
 * Returns { allowed, credits, maxCredits, percent }
 */
function consumeCredit() {
  const state = getBatteryState();
  
  if (state.credits <= 0) {
    return { allowed: false, ...state, percent: 0 };
  }
  
  state.credits -= 1;
  state.totalUsed = (state.totalUsed || 0) + 1;
  state.lastUpdated = Date.now();
  writeBattery(state);
  
  return {
    allowed: true,
    credits: state.credits,
    maxCredits: state.maxCredits,
    percent: Math.round((state.credits / state.maxCredits) * 100),
    plan: state.plan,
    totalUsed: state.totalUsed,
  };
}

let lastModelSwitch = null;
function switchModel(model) {
  if (lastModelSwitch === model) return;
  try {
    execSync(`openclaw config set agents.defaults.model "${model}" 2>/dev/null`, { timeout: 5000 });
    lastModelSwitch = model;
    console.log(`[battery] Switched model to ${model}`);
  } catch {}
}

// ═══════════════════════════════════════════════════════════════
// Express middleware
// ═══════════════════════════════════════════════════════════════

export function usageGuard(req, res, next) {
  // Only guard chat messages
  if (req.path !== '/api/chat/send' || req.method !== 'POST') return next();

  // BYOK users have no limits
  if (isBYOK()) return next();

  const result = consumeCredit();

  if (!result.allowed) {
    const state = getBatteryState();
    const config = PLANS[state.plan] || PLANS.starter;
    const hoursToFull = Math.ceil((state.maxCredits - state.credits) / config.rechargePerHour);
    
    return res.json({
      ok: false,
      reply: `🔋 Battery empty! Your credits are recharging.\n\n` +
        `You'll have credits again in about **${Math.min(hoursToFull, 1)} hour**. ` +
        `Full recharge in ~${hoursToFull}h.\n\n` +
        `💡 **Want unlimited usage?** Add your own AI key in **Settings → AI Provider** (free Gemini key works!)\n\n` +
        `⚡ Or **upgrade to Pro** for 5× more credits and faster recharge.`,
      limited: true,
      battery: { credits: 0, maxCredits: state.maxCredits, percent: 0, plan: state.plan },
    });
  }

  // Low battery warning — switch to cheaper model
  if (result.percent <= DOWNGRADE_THRESHOLD * 100) {
    switchModel(DOWNGRADE_MODEL);
    req._usageNote = `\n\n_🔋 Battery at ${result.percent}% — using efficient model to conserve credits. Add your own API key for full performance._`;
  }

  req._usageInfo = {
    plan: result.plan,
    credits: result.credits,
    maxCredits: result.maxCredits,
    percent: result.percent,
  };
  next();
}

export function getUsageLimits(_req, res) {
  const byok = isBYOK();
  
  if (byok) {
    return res.json({
      plan: getPlan(),
      battery: { credits: -1, maxCredits: -1, percent: 100 },
      byok: true,
      limited: false,
    });
  }
  
  const state = getBatteryState();
  const config = PLANS[state.plan] || PLANS.starter;
  const percent = Math.round((state.credits / state.maxCredits) * 100);
  const hoursToFull = state.credits >= state.maxCredits ? 0 :
    Math.ceil((state.maxCredits - state.credits) / config.rechargePerHour);

  res.json({
    plan: state.plan,
    battery: {
      credits: state.credits,
      maxCredits: state.maxCredits,
      percent,
      rechargePerHour: config.rechargePerHour,
      hoursToFull,
    },
    byok: false,
    limited: state.credits <= 0,
    downgraded: percent <= DOWNGRADE_THRESHOLD * 100 && percent > 0,
  });
}
