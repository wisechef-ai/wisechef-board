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

/**
 * Check if OpenClaw gateway is responding
 */
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

// Role mapping from agent id
const ROLE_MAP = {
  'wisechef-ceo': 'Chief Executive Officer',
  'wisechef-engineer': 'Lead Engineer',
  'wisechef-growth': 'Growth Lead',
  'wisechef-devops': 'DevOps Engineer',
  'main': 'Personal Assistant',
};

// Channel mapping from agent id
const CHANNEL_MAP = {
  'wisechef-ceo': 'wc-ceo-office',
  'wisechef-engineer': 'wc-dev-log',
  'wisechef-growth': 'wc-content-drafts',
  'wisechef-devops': 'wc-alerts',
  'main': 'general',
};

/**
 * GET /api/agents
 * Returns list of agents from OpenClaw config with local overrides
 */
export async function listAgents(_req, res) {
  const ocConfig = readOpenClawConfig();
  const agentsConfig = readAgentsConfig();
  const agentsList = ocConfig?.agents?.list || [];

  const agents = agentsList.map((agent) => {
    const agentCfg = agentsConfig[agent.id] || {};
    return {
      id: agent.id,
      name: agent.name || agent.id,
      role: ROLE_MAP[agent.id] || agentCfg.role || 'Agent',
      status: 'active',
      home_channel: CHANNEL_MAP[agent.id] || null,
      model: agent.model || ocConfig?.agents?.defaults?.model?.primary || 'unknown',
      thinking: agentCfg.thinking || 'off',
      workspace: agent.workspace || null,
      canSpawnSubagents: !!(agent.subagents?.allowAgents?.length),
    };
  });

  res.json({ agents });
}

/**
 * GET /api/agents/status
 * Returns live online/offline status from OpenClaw gateway
 */
export async function agentsStatus(_req, res) {
  const gateway = await checkGateway();
  const ocConfig = readOpenClawConfig();
  const agentsList = ocConfig?.agents?.list || [];

  // If gateway is online, all configured agents are online (they're in-process)
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
 * PUT /api/agents/:id
 * Update agent config (model, thinking level)
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

  // Save local config (thinking, display prefs)
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
