import fs from 'fs';
import path from 'path';

// ═══════════════════════════════════════════════════════════════
// BATTERY USAGE SYSTEM — "Smartphone-style" recharging credits
// ═══════════════════════════════════════════════════════════════
//
// Every user gets the same battery:
//   - 50 credits max (full charge)
//   - +1 credit per hour passive recharge
//   - ~50 hours from empty to full
//   - Max theoretical usage: ~720 messages/month
//   - All tiers use anthropic/claude-sonnet-4.6
//   - BYOK users bypass entirely (unlimited)
//
// Promo: first 39 users get lifetime Pro features
// ═══════════════════════════════════════════════════════════════

const PLANS = {
  starter:    { maxCredits: 50, rechargePerHour: 1 },
  pro:        { maxCredits: 50, rechargePerHour: 1 },
  enterprise: { maxCredits: 50, rechargePerHour: 1 },
};

// BETA PROMO: first 39 users get lifetime Pro
const BETA_PROMO_LIMIT = 39;

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
    // Check provider-keys.json for user-added keys (not the system OpenRouter key)
    let provKeys = {};
    try { provKeys = JSON.parse(fs.readFileSync(path.join(homeDir, '.openclaw', 'provider-keys.json'), 'utf8')); } catch {}
    for (const [provName, prov] of Object.entries(provKeys)) {
      // Skip the system-provided openrouter key — that's not BYOK
      if (provName === 'openrouter') continue;
      if (prov.apiKey && prov.apiKey.trim()) return true;
    }
    // Check env vars (GEMINI/OPENAI = user-provided; OPENROUTER = system-provided, skip)
    if (process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY) return true;
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
      reply: `🔋 Battery empty! Recharging at 1 credit per hour.\n\n` +
        `You'll have a credit again in about **1 hour**. ` +
        `Full recharge in ~${hoursToFull}h.\n\n` +
        `💡 **Want unlimited usage?** Add your own AI key in **Settings → AI Provider** (a free Gemini key works!)`,
      limited: true,
      battery: { credits: 0, maxCredits: state.maxCredits, percent: 0, plan: state.plan },
    });
  }

  // Low battery warning (below 20%)
  if (result.percent <= 20 && result.percent > 0) {
    req._usageNote = `\n\n_🔋 Battery at ${result.percent}% (${result.credits}/${result.maxCredits} credits). Recharging 1/hr. Add your own API key in Settings for unlimited usage._`;
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
  });
}
