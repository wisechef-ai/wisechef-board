import fs from 'fs';
import path from 'path';
import { OPENCLAW_DIR, WORKSPACE } from '../config.js';
import { readOpenclawJson } from '../lib/fileStore.js';
import {
  getTimezone, startOfDayInTz, startOfWeekInTz, startOfMonthInTz,
} from '../lib/timezone.js';
import { formatDuration } from '../lib/format.js';

// Read battery state directly (same file as usageGuard)
function readBatteryState() {
  const batteryFile = path.join(process.env.HOME || '/root', '.openclaw', 'battery.json');
  try {
    return JSON.parse(fs.readFileSync(batteryFile, 'utf-8'));
  } catch {
    return null;
  }
}

export function getUsage(req, res) {
  const now = new Date();
  const sessionsDir = path.join(OPENCLAW_DIR, 'agents', 'main', 'sessions');
  const tz = getTimezone();
  const todayStart = startOfDayInTz(now, tz);
  const weekStart = startOfWeekInTz(now, tz);
  const monthStart = startOfMonthInTz(now, tz);

  let tokensToday = 0, tokensMonth = 0;
  let costToday = 0, costMonth = 0;
  const sessionsToday = new Set(), sessionsMonth = new Set();

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
            const tokens = (usage.input || 0) + (usage.output || 0) + (usage.cacheRead || 0);
            const cost = usage.cost.total;
            const ts = new Date(entry.timestamp || stat.mtime);
            if (ts >= monthStart) { tokensMonth += tokens; costMonth += cost; sessionsMonth.add(file); }
            if (ts >= todayStart) { tokensToday += tokens; costToday += cost; sessionsToday.add(file); }
          }
        } catch {}
      }
    }
  } catch {}

  const config = readOpenclawJson();
  const modelRaw = config.agents?.defaults?.model;
  const model = typeof modelRaw === 'string' ? modelRaw : modelRaw?.primary || 'unknown';

  // Battery state
  const battery = readBatteryState();
  const maxCredits = battery?.maxCredits || 50;
  const credits = battery ? Math.min(maxCredits, battery.credits) : maxCredits;
  const rechargePerHour = 1;
  const batteryPercent = Math.round((credits / maxCredits) * 100);
  const hoursToFull = credits >= maxCredits ? 0 : Math.ceil((maxCredits - credits) / rechargePerHour);

  // Check BYOK — user-added keys (not the system-provided OpenRouter key)
  let byok = false;
  try {
    const provKeysPath = path.join(process.env.HOME || '/root', '.openclaw', 'provider-keys.json');
    const provKeys = JSON.parse(fs.readFileSync(provKeysPath, 'utf-8'));
    for (const [provName, prov] of Object.entries(provKeys)) {
      // Skip the system-provided openrouter key — that's not BYOK
      if (provName === 'openrouter') continue;
      if (prov.apiKey && prov.apiKey.trim()) { byok = true; break; }
    }
  } catch {}
  if (process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY) byok = true;

  res.json({
    model,
    timezone: tz,
    battery: {
      credits: byok ? -1 : credits,
      maxCredits,
      percent: byok ? 100 : batteryPercent,
      rechargePerHour,
      hoursToFull: byok ? 0 : hoursToFull,
      totalUsed: battery?.totalUsed || 0,
    },
    byok,
    // Keep tiers for backward compat but now battery-based
    tiers: [
      {
        label: '🔋 Battery',
        percent: byok ? 100 : batteryPercent,
        resetsIn: byok ? '∞ (BYOK)' : hoursToFull > 0 ? `full in ~${hoursToFull}h` : 'fully charged',
        tokens: tokensToday,
        cost: costToday,
      },
    ],
    details: {
      today: { tokens: tokensToday, cost: costToday, sessions: sessionsToday.size },
      month: { tokens: tokensMonth, cost: costMonth, sessions: sessionsMonth.size },
    },
  });
}

// ─── /api/usage/current-month ─────────────────────────────────────────────────
// Returns per-client monthly usage from enterprise workspace usage/YYYY-MM.json.
// Mirrors the schema written by wisechef-enterprise's usage-tracker.js.
// Used by the board dashboard and future fleet views.
//
// Response (when enterprise usage file exists):
//   { source: 'enterprise', month, clientSlug, messages, tokensIn, tokensOut,
//     estimatedCostUsd, alertFiredAt, lastUpdated }
//
// Fallback (no enterprise file — standard consumer board instance):
//   { source: 'board', month, messages, tokensIn, tokensOut, estimatedCostUsd }

function monthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function readEnterpriseUsage(month) {
  // Enterprise usage lives at: {WORKSPACE}/usage/YYYY-MM.json
  // WORKSPACE is ~/.openclaw/workspace on standard installs
  const usagePath = path.join(WORKSPACE, 'usage', `${month}.json`);
  try {
    return JSON.parse(fs.readFileSync(usagePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function getCurrentMonthUsage(req, res) {
  const month = req.query.month || monthKey();

  // Try enterprise usage file first
  const enterprise = readEnterpriseUsage(month);
  if (enterprise) {
    return res.json({ source: 'enterprise', ...enterprise });
  }

  // Fallback: aggregate from OpenClaw session JSONL files (same as getUsage)
  const sessionsDir = path.join(OPENCLAW_DIR, 'agents', 'main', 'sessions');
  const now = new Date();
  const tz = getTimezone();
  const monthStart = startOfMonthInTz(now, tz);

  let messages = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let estimatedCostUsd = 0;

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
          if (!usage) continue;
          const ts = new Date(entry.timestamp || stat.mtime);
          if (ts < monthStart) continue;
          messages += 1;
          tokensIn += (usage.input || 0);
          tokensOut += (usage.output || 0) + (usage.cacheRead || 0);
          if (usage.cost?.total) estimatedCostUsd += usage.cost.total;
        } catch {}
      }
    }
  } catch {}

  estimatedCostUsd = Math.round(estimatedCostUsd * 10000) / 10000;

  res.json({
    source: 'board',
    month,
    messages,
    tokensIn,
    tokensOut,
    estimatedCostUsd,
  });
}
