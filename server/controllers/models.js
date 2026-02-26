import {
  readOpenclawJson, writeOpenclawJson, readHeartbeat, writeHeartbeat,
} from '../lib/fileStore.js';
import { broadcast } from '../broadcast.js';

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

export function listModels(req, res) {
  try {
    const config = readOpenclawJson();
    const currentModel = config.agents?.defaults?.model;
    const current = typeof currentModel === 'string' ? currentModel : currentModel?.primary;
    
    // Combine defaults with any custom models in config
    const models = new Set([...DEFAULT_MODELS]);
    if (current) models.add(current);
    
    res.json([...models]);
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
    // Return which providers have keys set (don't expose actual keys)
    const result = {};
    for (const [name, prov] of Object.entries(providers)) {
      result[name] = { hasKey: !!prov.apiKey, masked: prov.apiKey ? '••••' + prov.apiKey.slice(-4) : null };
    }
    res.json(result);
  } catch { res.json({}); }
}

export function setProviderKey(req, res) {
  const { provider, apiKey } = req.body;
  if (!provider || !apiKey) return res.status(400).json({ error: 'provider and apiKey required' });
  
  const allowed = ['anthropic', 'openai', 'google', 'openrouter'];
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

export function getHeartbeat(req, res) {
  res.json(readHeartbeat());
}

export function postHeartbeat(req, res) {
  const data = { lastHeartbeat: Date.now() };
  writeHeartbeat(data);
  broadcast('heartbeat', data);
  res.json(data);
}
