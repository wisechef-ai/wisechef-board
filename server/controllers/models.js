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

// Known models per provider — kept current with openclaw docs + provider catalogs
const PROVIDER_MODELS = {
  'github-copilot': [
    'github-copilot/claude-sonnet-4-6', 'github-copilot/claude-opus-4-6', 'github-copilot/claude-sonnet-4.5',
    'github-copilot/gpt-4.1', 'github-copilot/gpt-5-mini', 'github-copilot/gpt-5.1', 'github-copilot/gpt-5.2',
    'github-copilot/o3-mini', 'github-copilot/o4-mini',
    'github-copilot/gemini-2.5-pro', 'github-copilot/gemini-3-flash', 'github-copilot/gemini-3-pro', 'github-copilot/gemini-3.1-pro',
  ],
  'anthropic': [
    'anthropic/claude-sonnet-4-6', 'anthropic/claude-opus-4-6', 'anthropic/claude-opus-4-5',
    'anthropic/claude-sonnet-4.5', 'anthropic/claude-sonnet-4', 'anthropic/claude-haiku-4-5',
  ],
  'openai': [
    'openai/gpt-5.2', 'openai/gpt-5.1', 'openai/gpt-5-mini', 'openai/gpt-4.1', 'openai/gpt-4.1-mini',
    'openai/o3-mini', 'openai/o4-mini',
  ],
  'google': [
    'google/gemini-3.1-pro', 'google/gemini-3-pro', 'google/gemini-3-flash', 'google/gemini-2.5-pro', 'google/gemini-2.5-flash',
  ],
  'openrouter': [], // fetched dynamically from OpenRouter API when key is connected
};

export async function listModels(req, res) {
  try {
    const { execSync } = await import('child_process');
    const config = readOpenclawJson();
    const currentModel = config.agents?.defaults?.model;
    const current = typeof currentModel === 'string' ? currentModel : currentModel?.primary;
    
    // Start with live models from openclaw
    const modelSet = new Set();
    try {
      const output = execSync('openclaw models list 2>/dev/null', { timeout: 10000, encoding: 'utf8' });
      const lines = output.split('\n').filter(l => l.trim() && !l.startsWith('Model'));
      lines.forEach(l => {
        const parts = l.trim().split(/\s{2,}/);
        const tags = parts[5] || '';
        if (parts[0] && !tags.includes('missing')) modelSet.add(parts[0]);
      });
    } catch {}
    
    // Add known models for connected providers (auth profiles + provider keys)
    const connectedProviders = new Set();
    // Check auth profiles (e.g. github-copilot device flow)
    const authProfiles = config.auth?.profiles || {};
    Object.values(authProfiles).forEach(p => { if (p.provider) connectedProviders.add(p.provider); });
    // Check provider API keys
    const providers = config.providers || {};
    Object.keys(providers).forEach(p => { if (providers[p]?.apiKey) connectedProviders.add(p); });
    // Always include anthropic (default/included)
    connectedProviders.add('anthropic');
    
    connectedProviders.forEach(provider => {
      (PROVIDER_MODELS[provider] || []).forEach(m => modelSet.add(m));
    });
    
    // Fetch OpenRouter models dynamically if connected
    if (connectedProviders.has('openrouter')) {
      try {
        const orRes = await fetch('https://openrouter.ai/api/v1/models');
        const orData = await orRes.json();
        if (orData.data) {
          // Get top models by context length and recency, prefix with openrouter/
          orData.data
            .filter(m => m.id && !m.id.includes(':free'))
            .sort((a, b) => (b.context_length || 0) - (a.context_length || 0))
            .slice(0, 30) // top 30 models
            .forEach(m => modelSet.add(`openrouter/${m.id}`));
        }
      } catch {}
    }
    
    // Ensure current model is in list
    if (current) modelSet.add(current);
    
    res.json([...modelSet]);
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
      const profiles = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
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
    // Remove API key
    if (config.providers?.[provider]) {
      delete config.providers[provider].apiKey;
      if (Object.keys(config.providers[provider]).length === 0) delete config.providers[provider];
      if (Object.keys(config.providers).length === 0) delete config.providers;
    }
    // Remove auth profiles (e.g. github-copilot device flow)
    if (config.auth?.profiles) {
      for (const key of Object.keys(config.auth.profiles)) {
        if (key.startsWith(provider + ':') || config.auth.profiles[key]?.provider === provider) {
          delete config.auth.profiles[key];
        }
      }
    }
    if (config.auth?.order?.[provider]) delete config.auth.order[provider];
    // Also remove auth-profiles.json entries
    try {
      const homeDir = process.env.HOME || '/root';
      for (const agentDir of ['default', 'main']) {
        const profilePath = path.join(homeDir, '.openclaw', 'agents', agentDir, 'agent', 'auth-profiles.json');
        if (fs.existsSync(profilePath)) {
          const profiles = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
          for (const key of Object.keys(profiles.profiles || {})) {
            if (key.startsWith(provider + ':')) delete profiles.profiles[key];
          }
          fs.writeFileSync(profilePath, JSON.stringify(profiles, null, 2));
        }
      }
    } catch {}
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
        // Set auth order so openclaw uses this profile
        if (!config.auth.order) config.auth.order = {};
        config.auth.order['github-copilot'] = ['github-copilot:github'];
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
