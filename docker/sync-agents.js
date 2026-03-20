#!/usr/bin/env node
/**
 * sync-agents.js — Synchronize Paperclip companies → OpenClaw agents
 * 
 * Reads all companies from Paperclip, ensures each has a dedicated OpenClaw agent
 * with an isolated workspace. Updates openclaw.json and creates workspace files.
 * 
 * Run after Paperclip bootstrap, before the board starts.
 * 
 * Environment:
 *   PAPERCLIP_PORT  — Paperclip API port (default 3100)
 *   GATEWAY_TOKEN   — OpenClaw gateway auth token
 *   WISECHEF_MODEL  — LLM model (default openrouter/anthropic/claude-sonnet-4-6)
 *   WORKSPACE_DIR   — Base workspace dir (default /opt/wisechef/workspace)
 */

import http from 'http';
import fs from 'fs';
import path from 'path';

const PAPERCLIP_PORT = parseInt(process.env.PAPERCLIP_PORT || '3100', 10);
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '';
const WISECHEF_MODEL = process.env.WISECHEF_MODEL || 'openrouter/anthropic/claude-sonnet-4-6';
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/opt/wisechef/workspace';
const OPENCLAW_CONFIG = '/root/.openclaw/openclaw.json';
const MANIFEST_PATH = '/opt/wisechef/manifest.json';

function apiCall(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: PAPERCLIP_PORT,
      path: apiPath,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function readManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')); }
  catch { return {}; }
}

/**
 * Create per-company workspace with SOUL.md and MEMORY.md
 */
function createCompanyWorkspace(companyId, companyName) {
  const wsDir = path.join(WORKSPACE_DIR, 'companies', companyId);
  fs.mkdirSync(wsDir, { recursive: true });

  const soulPath = path.join(wsDir, 'SOUL.md');
  if (!fs.existsSync(soulPath)) {
    fs.writeFileSync(soulPath, `# SOUL.md — ${companyName}

You are an AI agent working for **${companyName}**, powered by WiseChef.

## Your Company
- Company: ${companyName}
- Company ID: ${companyId}

## Task System
You have a task board. During heartbeats, check for pending tasks:
1. GET http://localhost:3333/api/tasks/queue?limit=capacity
2. For each task: POST /api/tasks/:id/pickup
3. Work on the task
4. Complete: POST /api/tasks/:id/complete with {"result": "summary"}

## Communication Style
- Be helpful, concise, and direct
- Just help. Actions over words.
- If you're not sure, say so

## Important
- You work ONLY for ${companyName}
- Do NOT access files outside your workspace
- Your workspace: ${wsDir}
`);
    console.log(`[sync-agents] Created SOUL.md for ${companyName}`);
  }

  const memoryPath = path.join(wsDir, 'MEMORY.md');
  if (!fs.existsSync(memoryPath)) {
    fs.writeFileSync(memoryPath, `# MEMORY.md — ${companyName}\n\n## Notes\n(empty)\n`);
  }

  return wsDir;
}

/**
 * Claim a Paperclip API key for a company's first agent
 */
async function claimApiKey(companyId, agents, wsDir) {
  const keyPath = path.join(wsDir, 'paperclip-api-key.json');
  if (fs.existsSync(keyPath)) {
    console.log(`[sync-agents] API key already exists for company ${companyId}`);
    return;
  }

  const agent = agents[0];
  if (!agent) return;

  try {
    const keyData = await apiCall('POST', `/api/agents/${agent.id}/keys`, {
      name: `openclaw-company-${companyId.substring(0, 8)}`,
    });
    if (keyData && keyData.token) {
      fs.writeFileSync(keyPath, JSON.stringify(keyData, null, 2), { mode: 0o600 });
      console.log(`[sync-agents] Claimed API key for ${agent.name} (${companyId.substring(0, 8)})`);
    }
  } catch (e) {
    console.error(`[sync-agents] Failed to claim key for ${companyId}:`, e.message);
  }
}

/**
 * Update Paperclip agents to use company-specific agentId
 */
async function fixAgentIds(companyId, agents) {
  const targetAgentId = `company-${companyId}`;
  for (const agent of agents) {
    const cfg = agent.adapterConfig || {};
    if (cfg.agentId !== targetAgentId || cfg.timeoutSec !== 240) {
      await apiCall('PATCH', `/api/agents/${agent.id}`, {
        adapterConfig: {
          ...cfg,
          url: 'ws://localhost:18789/gateway',
          authToken: GATEWAY_TOKEN,
          agentId: targetAgentId,
          timeoutSec: 240,
        },
      });
      console.log(`[sync-agents] Fixed ${agent.name} → agentId=${targetAgentId}, timeout=240s`);
    }
  }
}

async function main() {
  // Load existing config
  let config;
  try {
    config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8'));
  } catch {
    console.error('[sync-agents] Cannot read openclaw.json');
    process.exit(1);
  }

  const plan = (process.env.WISECHEF_PLAN || 'pro').toLowerCase();
  const manifest = readManifest();
  const planLimits = {
    starter: { companyAgents: 0 },
    pro: { companyAgents: 4 },
    enterprise: { companyAgents: 20 },
  };
  const selectedPlan = planLimits[plan] ? plan : 'starter';
  const envLimit = Number(process.env.WISECHEF_COMPANY_AGENT_LIMIT || '');
  const maxCompanyAgents = Number.isFinite(envLimit) && envLimit >= 0
    ? Math.floor(envLimit)
    : planLimits[selectedPlan].companyAgents;

  // Starter tier: single "main" agent only.
  // Pro/Enterprise: main + dedicated company agents, capped by plan or override env.
  if (maxCompanyAgents <= 0) {
    console.log(`[sync-agents] Plan=${selectedPlan} — keeping single main agent, skipping company sync`);

    // Ensure Paperclip agents point to "main" (not company-UUID)
    const companies = await apiCall('GET', '/api/companies');
    if (Array.isArray(companies)) {
      for (const company of companies) {
        const agents = await apiCall('GET', `/api/companies/${company.id}/agents`);
        if (Array.isArray(agents)) {
          for (const agent of agents) {
            const cfg = agent.adapterConfig || {};
            if (cfg.agentId !== 'main') {
              await apiCall('PATCH', `/api/agents/${agent.id}`, {
                adapterConfig: { ...cfg, url: 'ws://localhost:18789/gateway', authToken: GATEWAY_TOKEN, agentId: 'main', timeoutSec: 240 },
              });
              console.log(`[sync-agents] Fixed ${agent.name} → agentId=main`);
            }
          }
        }
      }
    }

    // Preserve existing main-only config, don't overwrite
    const existingList = config.agents?.list || [];
    if (existingList.length <= 1) {
      console.log('[sync-agents] Config already has single agent — no changes');
    } else {
      config.agents.list = existingList.filter(a => a.id === 'main');
      fs.writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2));
      console.log('[sync-agents] Trimmed to main agent only');
    }

    process.exit(0);
  }

  // ── Multi-agent tier: main + per-company agents ──

  // Get all companies from Paperclip
  const companies = await apiCall('GET', '/api/companies');
  if (!Array.isArray(companies) || companies.length === 0) {
    console.log('[sync-agents] No companies found — nothing to sync');
    process.exit(0);
  }

  // Limit company agents by plan or explicit override.
  const companiesToSync = companies.slice(0, maxCompanyAgents);
  if (companies.length > maxCompanyAgents) {
    console.log(`[sync-agents] Warning: ${companies.length} companies found, only syncing first ${maxCompanyAgents}`);
  }

  // Build agent list: main (personal) + one per company
  const agentList = [
    {
      id: 'main',
      default: true,
      workspace: WORKSPACE_DIR,
      identity: { name: 'Chef' },
      heartbeat: {
        every: '5m',
        prompt: 'Check for pending tasks: curl -sf http://localhost:3333/api/tasks/queue?limit=capacity | Read the JSON. For each task, pick it up (POST /api/tasks/:id/pickup), work on it, then complete it (POST /api/tasks/:id/complete with {result, status}). If no tasks, reply HEARTBEAT_OK.',
        target: 'none',
      },
    },
  ];

  for (const company of companiesToSync) {
    const companyAgentId = `company-${company.id}`;
    const wsDir = createCompanyWorkspace(company.id, company.name);

    agentList.push({
      id: companyAgentId,
      workspace: wsDir,
      identity: { name: `${company.name} Agent` },
      heartbeat: {
        every: '5m',
        prompt: `You are working for ${company.name}. Check for pending tasks: curl -sf http://localhost:3333/api/tasks/queue?limit=capacity | Read the JSON. For each task, pick it up (POST /api/tasks/:id/pickup), work on it, then complete it (POST /api/tasks/:id/complete with {result, status}). If no tasks, reply HEARTBEAT_OK.`,
        target: 'none',
      },
    });

    // Fix Paperclip agent configs to point to company-specific OpenClaw agent
    const agents = await apiCall('GET', `/api/companies/${company.id}/agents`);
    if (Array.isArray(agents)) {
      await fixAgentIds(company.id, agents);
      await claimApiKey(company.id, agents, wsDir);
    }
  }

  // Update config
  config.agents = config.agents || {};
  config.agents.list = agentList;

  // Preserve defaults
  config.agents.defaults = config.agents.defaults || {};
  config.agents.defaults.model = config.agents.defaults.model || { primary: WISECHEF_MODEL };
  config.agents.defaults.thinkingDefault = config.agents.defaults.thinkingDefault || 'low';

  fs.writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2));
  console.log(`[sync-agents] Wrote ${agentList.length} agents to openclaw.json`);

  // Also save the legacy key file for backward compat (main agent)
  const mainKeyPath = path.join(WORKSPACE_DIR, 'paperclip-claimed-api-key.json');
  if (!fs.existsSync(mainKeyPath)) {
    // Copy from first company's key
    const firstCompanyDir = path.join(WORKSPACE_DIR, 'companies', companies[0].id);
    const firstKeyPath = path.join(firstCompanyDir, 'paperclip-api-key.json');
    if (fs.existsSync(firstKeyPath)) {
      fs.copyFileSync(firstKeyPath, mainKeyPath);
      console.log('[sync-agents] Copied first company key → main workspace');
    }
  }
}

main()
  .then(() => {
    console.log('[sync-agents] Done');
    process.exit(0);
  })
  .catch((e) => {
    console.error('[sync-agents] Fatal:', e.message);
    process.exit(1);
  });
