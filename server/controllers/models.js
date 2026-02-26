import {
  readOpenclawJson, writeOpenclawJson, readHeartbeat, writeHeartbeat,
} from '../lib/fileStore.js';
import { broadcast } from '../broadcast.js';
import fs from 'fs';
import path from 'path';

// Default models available to all users
const DEFAULT_MODELS = [
  'anthropic/claude-sonnet-4-6',
  'anthropic/claude-haiku-4-5',
  'anthropic/claude-opus-4-6',
  'google/gemini-2.5-flash',
  'google/gemini-2.5-pro',
  'openai/gpt-4.1',
  'openai/gpt-4.1-mini',
];

export async function listModels(req, res) {
  try {
    const { execSync } = await import('child_process');
    const config = readOpenclawJson();
    const currentModel = config.agents?.defaults?.model;
    const current = typeof currentModel === 'string' ? currentModel : currentModel?.primary;
    
    // Get live model list from openclaw
    let models = [];
    try {
      const output = execSync('openclaw models list 2>/dev/null', { timeout: 10000, encoding: 'utf8' });
      // Parse table output: "model_name   input   ctx   local   auth   tags"
      const lines = output.split('\n').filter(l => l.trim() && !l.startsWith('Model'));
      models = lines.map(l => {
        const parts = l.trim().split(/\s{2,}/);
        return { id: parts[0], tags: parts[5] || '' };
      }).filter(m => m.id && !m.tags.includes('missing'));
    } catch {}
    
    // If openclaw models list failed or returned empty, use defaults
    if (models.length === 0) {
      models = DEFAULT_MODELS.map(m => ({ id: m, tags: '' }));
    }
    
    // Ensure current model is in list
    if (current && !models.find(m => m.id === current)) {
      models.unshift({ id: current, tags: 'default' });
    }
    
    res.json(models.map(m => m.id));
  } catch {
    res.json(DEFAULT_MODELS);
  }
}

export function setModel(req, res) {
  const { model } = req.body;
  if (!model) return res.status(400).json({ error: 'model required' });
  try {
    const config = readOpenclawJson();
    if (!config.agents) config.agents = {};
    if (!config.agents.defaults) config.agents.defaults = {};
    // Store as string (consistent with entrypoint and openclaw config set)
    config.agents.defaults.model = model;
    writeOpenclawJson(config);
    res.json({ success: true, model });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export function getProviderKeys(_req, res) {
  try {
    const config = readOpenclawJson();
    const providers = config.providers || {};
    const result = {};
    for (const [name, prov] of Object.entries(providers)) {
      result[name] = { hasKey: !!prov.apiKey, masked: prov.apiKey ? '••••' + prov.apiKey.slice(-4) : null };
    }
    
    // Check auth-profiles.json for device-flow providers (github-copilot)
    try {
      const homeDir = process.env.HOME || '/root';
      const profilePath = path.join(homeDir, '.openclaw', 'agents', 'default', 'agent', 'auth-profiles.json');
      const profiles = JSON.parse(fs.readFileSync(profPath, 'utf8'));
      if (profiles.profiles?.['github-copilot:github']?.token) {
        result['github-copilot'] = { hasKey: true, hasAuth: true, masked: '(device login)' };
      }
    } catch {}
    
    res.json(result);
  } catch { res.json({}); }
}

export function setProviderKey(req, res) {
  const { provider, apiKey } = req.body;
  if (!provider || !apiKey) return res.status(400).json({ error: 'provider and apiKey required' });
  
  const allowed = ['anthropic', 'openai', 'google', 'openrouter', 'github-copilot', 'venice', 'ollama'];
  if (!allowed.includes(provider)) return res.status(400).json({ error: `Provider must be one of: ${allowed.join(', ')}` });
  
  try {
    const config = readOpenclawJson();
    if (!config.providers) config.providers = {};
    if (!config.providers[provider]) config.providers[provider] = {};
    config.providers[provider].apiKey = apiKey;
    writeOpenclawJson(config);
    res.json({ success: true, provider, masked: '••••' + apiKey.slice(-4) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export function removeProviderKey(req, res) {
  const { provider } = req.params;
  try {
    const config = readOpenclawJson();
    if (config.providers?.[provider]) {
      delete config.providers[provider].apiKey;
      if (Object.keys(config.providers[provider]).length === 0) delete config.providers[provider];
      if (Object.keys(config.providers).length === 0) delete config.providers;
    }
    writeOpenclawJson(config);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export function loginProvider(req, res) {
  const { provider, method } = req.body;
  if (!provider || !method) return res.status(400).json({ error: 'provider and method required' });
  
  if (method === 'setup-token') {
    return res.json({
      success: false,
      interactive: true,
      instructions: [
        '1. Open claude.ai and sign in to your Claude Pro/Max account',
        '2. Open a terminal and run: claude setup-token',
        '3. Copy the token it gives you',
        '4. Paste it as your API key in the field above',
      ]
    });
  }
  
  if (method === 'openai-codex') {
    return res.json({
      success: false,
      interactive: true,
      instructions: [
        '1. Go to platform.openai.com and sign in with your ChatGPT account',
        '2. Go to API Keys → Create new key',
        '3. Copy the key (starts with sk-)',
        '4. Paste it in the API key field above',
      ]
    });
  }
  
  res.json({ success: false, error: 'Unknown auth method' });
}

// GitHub Copilot device flow
const GH_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const GH_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GH_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

// In-memory pending device flows
const pendingDeviceFlows = new Map();

export async function startDeviceFlow(req, res) {
  try {
    const r = await fetch(GH_DEVICE_CODE_URL, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: GH_CLIENT_ID, scope: 'read:user' }),
    });
    if (!r.ok) return res.status(502).json({ error: `GitHub returned ${r.status}` });
    const data = await r.json();
    
    const flowId = Math.random().toString(36).slice(2);
    pendingDeviceFlows.set(flowId, {
      deviceCode: data.device_code,
      expiresAt: Date.now() + data.expires_in * 1000,
      intervalMs: Math.max(1000, (data.interval || 5) * 1000),
    });
    
    res.json({
      flowId,
      userCode: data.user_code,
      verificationUrl: data.verification_uri,
      expiresIn: data.expires_in,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function pollDeviceFlow(req, res) {
  const { flowId } = req.body;
  const flow = pendingDeviceFlows.get(flowId);
  if (!flow) return res.status(404).json({ error: 'Unknown flow' });
  
  if (Date.now() > flow.expiresAt) {
    pendingDeviceFlows.delete(flowId);
    return res.json({ status: 'expired' });
  }
  
  try {
    const r = await fetch(GH_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GH_CLIENT_ID,
        device_code: flow.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const data = await r.json();
    
    if (data.access_token) {
      pendingDeviceFlows.delete(flowId);
      
      // Save auth profile to both default and main agent dirs
      const homeDir = process.env.HOME || '/root';
      const agentDirs = ['default', 'main'].map(a => 
        path.join(homeDir, '.openclaw', 'agents', a, 'agent')
      );
      
      for (const dir of agentDirs) {
        const profPath = path.join(dir, 'auth-profiles.json');
        fs.mkdirSync(dir, { recursive: true });
        let profiles = {};
        try { profiles = JSON.parse(fs.readFileSync(profPath, 'utf8')); } catch {}
        if (!profiles.profiles) profiles.profiles = {};
        profiles.profiles['github-copilot:github'] = {
          type: 'token',
          provider: 'github-copilot',
          token: data.access_token,
        };
        fs.writeFileSync(profPath, JSON.stringify(profiles, null, 2));
      }
      
      // Also update openclaw.json to reference the auth profile
      try {
        const config = readOpenclawJson();
        if (!config.auth) config.auth = {};
        if (!config.auth.profiles) config.auth.profiles = {};
        config.auth.profiles['github-copilot:github'] = {
          provider: 'github-copilot',
          mode: 'token',
        };
        writeOpenclawJson(config);
      } catch {}
      
      return res.json({ status: 'complete', provider: 'github-copilot' });
    }
    
    if (data.error === 'authorization_pending') return res.json({ status: 'pending' });
    if (data.error === 'slow_down') return res.json({ status: 'pending', slowDown: true });
    if (data.error === 'access_denied') {
      pendingDeviceFlows.delete(flowId);
      return res.json({ status: 'denied' });
    }
    if (data.error === 'expired_token') {
      pendingDeviceFlows.delete(flowId);
      return res.json({ status: 'expired' });
    }
    
    res.json({ status: 'error', error: data.error });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export function getHeartbeat(req, res) {
  res.json(readHeartbeat());
}

export function postHeartbeat(req, res) {
  const data = { lastHeartbeat: Date.now() };
  writeHeartbeat(data);
  broadcast('heartbeat', data);
  res.json(data);
}
