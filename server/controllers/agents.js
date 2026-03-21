import fs from 'fs';
import path from 'path';
import http from 'http';
import { WORKSPACE } from '../config.js';

// OpenClaw config — source of truth for agents
const OPENCLAW_CONFIG = path.join(process.env.HOME || '/root', '.openclaw', 'openclaw.json');
const AGENTS_CONFIG = path.join(WORKSPACE, 'config', 'agents.json');
const GATEWAY_PORT = 18789;

function readOpenClawConfig() {
  try {
    return JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf-8'));
  } catch {
    return {};
  }
}

function writeOpenClawConfig(config) {
  const dir = path.dirname(OPENCLAW_CONFIG);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2));
}

function readAgentsConfig() {
  try {
    return JSON.parse(fs.readFileSync(AGENTS_CONFIG, 'utf-8'));
  } catch {
    return {};
  }
}

function writeAgentsConfig(config) {
  const dir = path.dirname(AGENTS_CONFIG);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(AGENTS_CONFIG, JSON.stringify(config, null, 2));
}

function checkGateway() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${GATEWAY_PORT}/health`, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ online: true, ...JSON.parse(data) });
        } catch {
          resolve({ online: res.statusCode < 400 });
        }
      });
    });
    req.on('error', () => resolve({ online: false }));
    req.on('timeout', () => { req.destroy(); resolve({ online: false }); });
  });
}

function restartGateway() {
  return new Promise((resolve) => {
    // Use the gateway's own restart mechanism via kill -USR1
    try {
      const { execSync } = require('child_process');
      // Find gateway PID and send SIGUSR1 for graceful restart
      execSync('pkill -USR1 -f "openclaw gateway" 2>/dev/null || true', { timeout: 3000 });
      resolve({ ok: true });
    } catch {
      resolve({ ok: false });
    }
  });
}

function toSlug(value) {
  return String(value || '')
    .trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent';
}

const ROLE_MAP = {
  'wisechef-ceo': 'Chief Executive Officer',
  'wisechef-engineer': 'Lead Engineer',
  'wisechef-growth': 'Growth Lead',
  'wisechef-devops': 'DevOps Engineer',
  'main': 'Personal Assistant',
};

const CHANNEL_MAP = {
  'wisechef-ceo': 'wc-ceo-office',
  'wisechef-engineer': 'wc-dev-log',
  'wisechef-growth': 'wc-content-drafts',
  'wisechef-devops': 'wc-alerts',
  'main': 'general',
};

/**
 * GET /api/agents
 */
export async function listAgents(_req, res) {
  const ocConfig = readOpenClawConfig();
  const agentsConfig = readAgentsConfig();
  const agentsList = ocConfig?.agents?.list || [];

  // Also read role metadata from workspace/agents/ dirs
  const agents = agentsList.map((agent) => {
    const agentCfg = agentsConfig[agent.id] || {};

    // Try to read role.json from agent workspace
    let roleData = {};
    const wsPath = agent.workspace;
    if (wsPath) {
      try {
        roleData = JSON.parse(fs.readFileSync(path.join(wsPath, 'role.json'), 'utf-8'));
      } catch {}
    }

    return {
      id: agent.id,
      name: agent.identity?.name || agent.name || roleData.displayName || agent.id,
      role: ROLE_MAP[agent.id] || agentCfg.role || roleData.roleName || 'Agent',
      status: 'active',
      home_channel: CHANNEL_MAP[agent.id] || null,
      model: agent.model || ocConfig?.agents?.defaults?.model?.primary || ocConfig?.agents?.defaults?.model || 'default',
      thinking: agentCfg.thinking || 'off',
      workspace: agent.workspace || null,
      canSpawnSubagents: !!(agent.subagents?.allowAgents?.length),
      personality: roleData.personality || null,
      priorityFocus: roleData.priorityFocus || null,
    };
  });

  res.json({ agents });
}

/**
 * GET /api/agents/status
 */
export async function agentsStatus(_req, res) {
  const gateway = await checkGateway();
  const ocConfig = readOpenClawConfig();
  const agentsList = ocConfig?.agents?.list || [];

  const bots = {};
  for (const agent of agentsList) {
    bots[agent.id] = {
      online: gateway.online,
      model: agent.model || 'default',
    };
  }

  res.json({
    bots,
    gateway: gateway.online ? 'connected' : 'offline',
    uptime: gateway.uptime || null,
  });
}

/**
 * POST /api/agents
 * Create a new agent — adds to openclaw.json + creates workspace dir + SOUL.md
 */
export async function createAgent(req, res) {
  const { name, role, roleId, displayName, personality, priorityFocus } = req.body || {};
  const agentName = name || displayName;
  if (!agentName) {
    return res.status(400).json({ error: 'Agent name is required' });
  }

  const ocConfig = readOpenClawConfig();
  if (!ocConfig.agents) ocConfig.agents = { defaults: {}, list: [] };
  if (!Array.isArray(ocConfig.agents.list)) ocConfig.agents.list = [];

  // Check tier limits
  const tier = (process.env.WISECHEF_PLAN || 'starter').toLowerCase();
  const TIER_LIMITS = { starter: 1, pro: 5, enterprise: 21 };
  const maxAgents = TIER_LIMITS[tier] || 1;
  if (ocConfig.agents.list.length >= maxAgents) {
    return res.status(403).json({ error: `Agent limit reached for ${tier} plan (max ${maxAgents})` });
  }

  // Generate unique agent id
  const baseSlug = toSlug(agentName);
  let agentId = `company-${baseSlug}`;
  let counter = 2;
  while (ocConfig.agents.list.some(a => a.id === agentId)) {
    agentId = `company-${baseSlug}-${counter}`;
    counter++;
  }

  // Create agent workspace directory
  const agentWorkspace = path.join(WORKSPACE, 'agents', baseSlug);
  fs.mkdirSync(agentWorkspace, { recursive: true });

  // Generate SOUL.md
  const soulContent = [
    `# SOUL.md — ${agentName}`,
    '',
    `You are **${agentName}**, an AI agent${role ? ` serving as ${role}` : ''}.`,
    '',
    '## Your Role',
    priorityFocus ? `- Focus: ${priorityFocus}` : '- Focus: Execute tasks assigned to you efficiently',
    role ? `- Position: ${role}` : '',
    '',
    '## Communication Style',
    personality?.formality > 0.7 ? '- Be formal and professional' : '- Be friendly and approachable',
    personality?.proactivity > 0.7 ? '- Be proactive — anticipate needs' : '- Be responsive to requests',
    '',
    '## Operating Principles',
    '1. Complete tasks thoroughly',
    '2. Ask for clarification when needed',
    '3. Report progress regularly',
    '4. Flag blockers early',
    '',
  ].filter(Boolean).join('\n');
  fs.writeFileSync(path.join(agentWorkspace, 'SOUL.md'), soulContent, 'utf8');

  // Create HEARTBEAT.md
  fs.writeFileSync(path.join(agentWorkspace, 'HEARTBEAT.md'),
    `# HEARTBEAT.md — ${agentName}\n\nCheck for pending tasks. If nothing needs attention, reply HEARTBEAT_OK.\n`, 'utf8');

  // Create role.json metadata
  fs.writeFileSync(path.join(agentWorkspace, 'role.json'), JSON.stringify({
    roleId: roleId || baseSlug,
    roleName: role || 'Agent',
    displayName: agentName,
    personality: personality || { formality: 0.6, proactivity: 0.8 },
    priorityFocus: priorityFocus || '',
    createdAt: new Date().toISOString(),
  }, null, 2), 'utf8');

  // Add to openclaw.json
  const agentEntry = {
    id: agentId,
    workspace: agentWorkspace,
    identity: { name: agentName },
    heartbeat: {
      every: '30m',
      prompt: `You are ${agentName}. Check for pending tasks. If no tasks, reply HEARTBEAT_OK.`,
      target: 'none',
    },
  };
  ocConfig.agents.list.push(agentEntry);
  writeOpenClawConfig(ocConfig);

  // Save local agent config
  const agentsConfig = readAgentsConfig();
  agentsConfig[agentId] = {
    role: role || 'Agent',
    displayName: agentName,
    createdAt: new Date().toISOString(),
  };
  writeAgentsConfig(agentsConfig);

  // Restart gateway to pick up new agent
  const restarted = await restartGateway();

  res.json({
    ok: true,
    agent: {
      id: agentId,
      name: agentName,
      role: role || 'Agent',
      workspace: agentWorkspace,
      status: 'active',
    },
    gatewayRestarted: restarted.ok,
  });
}

/**
 * PUT /api/agents/:id
 */
export async function updateAgent(req, res) {
  const { id } = req.params;
  const { model, thinking } = req.body;

  const ocConfig = readOpenClawConfig();
  const agentsList = ocConfig?.agents?.list || [];
  const agent = agentsList.find(a => a.id === id);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const agentsConfig = readAgentsConfig();
  agentsConfig[id] = {
    ...agentsConfig[id],
    model: model || agent.model || 'default',
    thinking: thinking || 'off',
    updatedAt: new Date().toISOString(),
  };

  writeAgentsConfig(agentsConfig);
  res.json({ ok: true, agent: agentsConfig[id] });
}

/**
 * DELETE /api/agents/:id
 */
export async function deleteAgent(req, res) {
  const { id } = req.params;

  if (id === 'main') {
    return res.status(400).json({ error: 'Cannot delete the main agent' });
  }

  const ocConfig = readOpenClawConfig();
  const agentsList = ocConfig?.agents?.list || [];
  const agentIndex = agentsList.findIndex(a => a.id === id);

  if (agentIndex === -1) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  agentsList.splice(agentIndex, 1);
  writeOpenClawConfig(ocConfig);

  const agentsConfig = readAgentsConfig();
  delete agentsConfig[id];
  writeAgentsConfig(agentsConfig);

  const restarted = await restartGateway();
  res.json({ ok: true, deleted: id, gatewayRestarted: restarted.ok });
}
