import fs from 'fs';
import path from 'path';
import { __dirname, WORKSPACE } from '../config.js';

// ──── Agent Type file loader ────

const TYPES_DIR = path.join(__dirname, 'src', 'agent-types');

/**
 * Load all agent type JSON files from src/agent-types/
 * Returns array sorted by planGate then name.
 */
export function loadAgentTypes() {
  try {
    const files = fs.readdirSync(TYPES_DIR).filter(f => f.endsWith('.json'));
    return files
      .map(f => {
        try {
          return JSON.parse(fs.readFileSync(path.join(TYPES_DIR, f), 'utf8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => {
        const order = { starter: 0, pro: 1, enterprise: 2 };
        const diff = (order[a.planGate] ?? 9) - (order[b.planGate] ?? 9);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      });
  } catch {
    return [];
  }
}

/**
 * Load a single agent type by id.
 */
export function loadAgentType(id) {
  const filePath = path.join(TYPES_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// ──── Plan helpers ────

const PLAN_ORDER = { starter: 0, pro: 1, enterprise: 2 };

function planLevel(planId) {
  return PLAN_ORDER[planId] ?? 0;
}

function getWorkspacePlan() {
  // Try manifest.json first (Docker containers)
  const manifestPaths = [
    '/opt/wisechef/manifest.json',
    path.join(process.env.HOME || '/root', '.openclaw', 'manifest.json'),
  ];
  for (const p of manifestPaths) {
    try {
      const m = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (m.plan) return m.plan;
    } catch {}
  }
  return process.env.WISECHEF_PLAN || 'starter';
}

// ──── Sentinel helpers ────

function getAgentTypeFile() {
  return path.join(WORKSPACE, 'agent-type.json');
}

export function readAgentTypeSentinel() {
  try {
    return JSON.parse(fs.readFileSync(getAgentTypeFile(), 'utf8'));
  } catch {
    return null;
  }
}

function writeAgentTypeSentinel(id) {
  fs.writeFileSync(getAgentTypeFile(), JSON.stringify({
    id,
    setAt: new Date().toISOString(),
  }, null, 2));
}

// ──── Controllers ────

/**
 * GET /api/agent-types
 * Returns all agent types visible to this workspace's plan.
 */
export async function getAgentTypes(req, res) {
  const plan = getWorkspacePlan();
  const level = planLevel(plan);
  const all = loadAgentTypes();

  // Filter: only include types the current plan can access
  const visible = all.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    icon: t.icon,
    tags: t.tags || [],
    planGate: t.planGate,
    locked: planLevel(t.planGate) > level,
  }));

  const sentinel = readAgentTypeSentinel();

  res.json({
    types: visible,
    current: sentinel?.id || null,
    plan,
  });
}

/**
 * POST /api/agent/select
 * Body: { agentTypeId: string }
 * Writes SOUL.md from template + agent-type.json sentinel.
 */
export async function selectAgentType(req, res) {
  const { agentTypeId } = req.body;
  if (!agentTypeId) {
    return res.status(400).json({ error: 'agentTypeId is required' });
  }

  const plan = getWorkspacePlan();
  const level = planLevel(plan);

  const agentType = loadAgentType(agentTypeId);
  if (!agentType) {
    return res.status(404).json({ error: `Agent type "${agentTypeId}" not found` });
  }

  if (planLevel(agentType.planGate) > level) {
    return res.status(403).json({
      error: `"${agentType.name}" requires ${agentType.planGate} plan. Current plan: ${plan}`,
    });
  }

  const maxAllowed = agentType.maxPerPlan?.[plan] ?? 1;
  if (maxAllowed === 0) {
    return res.status(403).json({ error: `"${agentType.name}" is not available on the ${plan} plan` });
  }

  // Write SOUL.md from template
  const soulPath = path.join(WORKSPACE, 'SOUL.md');
  try {
    if (agentType.soulTemplate && !agentType.soulTemplate.includes('[PLACEHOLDER')) {
      fs.writeFileSync(soulPath, agentType.soulTemplate, 'utf8');
    }
  } catch (err) {
    console.error('Failed to write SOUL.md for agent type:', err);
    return res.status(500).json({ error: 'Failed to write agent configuration' });
  }

  // Write sentinel (blocks onboarding wizard from overwriting SOUL.md)
  writeAgentTypeSentinel(agentTypeId);

  res.json({
    ok: true,
    agentType: {
      id: agentType.id,
      name: agentType.name,
      icon: agentType.icon,
      introMessage: agentType.introMessage || null,
    },
  });
}
