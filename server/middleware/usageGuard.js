import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Monthly cost caps per plan (USD)
const PLAN_CAPS = {
  starter: 2,
  pro: 10,
  enterprise: 50,
};

const DOWNGRADE_THRESHOLD = 0.9; // 90% → switch to Haiku
const DOWNGRADE_MODEL = 'anthropic/claude-haiku-4-5';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-6';

// Cache to avoid reading files every request
let usageCache = { cost: 0, month: null, updatedAt: 0 };
const CACHE_TTL = 30_000; // 30s

function getMonthlyUsage() {
  const now = Date.now();
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

  if (usageCache.month === currentMonth && (now - usageCache.updatedAt) < CACHE_TTL) {
    return usageCache.cost;
  }

  const homeDir = process.env.HOME || '/root';
  const sessionsDir = path.join(homeDir, '.openclaw', 'agents', 'main', 'sessions');
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let totalCost = 0;

  try {
    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      const filePath = path.join(sessionsDir, file);
      const stat = fs.statSync(filePath);
      if (stat.mtime < monthStart) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      for (const line of content.split('\n').filter(Boolean)) {
        try {
          const entry = JSON.parse(line);
          const usage = entry.message?.usage || entry.usage;
          if (usage?.cost?.total) {
            const ts = new Date(entry.timestamp || stat.mtime);
            if (ts >= monthStart) {
              totalCost += usage.cost.total;
            }
          }
        } catch {}
      }
    }
  } catch {}

  usageCache = { cost: totalCost, month: currentMonth, updatedAt: now };
  return totalCost;
}

function getPlan() {
  // Try manifest first (Docker containers)
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
  
  // Check env var
  if (process.env.WISECHEF_PLAN) return process.env.WISECHEF_PLAN;
  
  return 'starter';
}

function isBYOK() {
  const homeDir = process.env.HOME || '/root';
  try {
    const config = JSON.parse(fs.readFileSync(path.join(homeDir, '.openclaw', 'openclaw.json'), 'utf8'));
    // If user has their own API key configured, they're BYOK
    const providers = config.providers || {};
    for (const [, prov] of Object.entries(providers)) {
      if (prov.apiKey && !prov.apiKey.startsWith('wisechef-')) return true;
    }
  } catch {}
  return false;
}

let lastModelSwitch = null;

function switchModel(model) {
  if (lastModelSwitch === model) return;
  try {
    execSync(`openclaw config set agents.defaults.model "${model}" 2>/dev/null`, { timeout: 5000 });
    lastModelSwitch = model;
    console.log(`[usage-guard] Switched model to ${model}`);
  } catch {}
}

export function usageGuard(req, res, next) {
  // Only guard chat messages
  if (req.path !== '/api/chat/send' || req.method !== 'POST') {
    return next();
  }

  // BYOK users have no limits
  if (isBYOK()) {
    return next();
  }

  const plan = getPlan();
  const cap = PLAN_CAPS[plan] || PLAN_CAPS.starter;
  const monthlyCost = getMonthlyUsage();
  const usagePercent = monthlyCost / cap;

  if (usagePercent >= 1.0) {
    // Hard block
    return res.json({
      ok: false,
      reply: `⚠️ You've reached your monthly usage limit ($${cap} for ${plan} plan). Your limit resets on the 1st of next month.\n\n💡 **Upgrade your plan** for higher limits, or **add your own API key** in Settings for unlimited usage.`,
      limited: true,
    });
  }

  if (usagePercent >= DOWNGRADE_THRESHOLD) {
    // Soft downgrade to Haiku
    switchModel(DOWNGRADE_MODEL);
    // Let the request through but inject a note
    req._usageNote = `\n\n_ℹ️ You're at ${Math.round(usagePercent * 100)}% of your monthly limit. Responses may be shorter to conserve usage. Upgrade or add your own API key for full performance._`;
  } else {
    // Ensure we're on the good model
    switchModel(DEFAULT_MODEL);
  }

  // Attach usage info for the response
  req._usageInfo = { plan, cap, cost: monthlyCost, percent: usagePercent };
  next();
}

export function getUsageLimits(_req, res) {
  const plan = getPlan();
  const cap = PLAN_CAPS[plan] || PLAN_CAPS.starter;
  const monthlyCost = getMonthlyUsage();
  const byok = isBYOK();

  res.json({
    plan,
    percent: Math.min(100, Math.round((monthlyCost / cap) * 100)),
    byok,
    downgraded: !byok && (monthlyCost / cap) >= DOWNGRADE_THRESHOLD,
    blocked: !byok && (monthlyCost / cap) >= 1.0,
  });
}
