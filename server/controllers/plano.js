import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { PLANO_ENABLED, PLANO_PORT, PLANO_CONFIG_PATH } from '../config.js';

let planoProcess = null;

const DEFAULT_CONFIG = `# Plano Model Routing Configuration
# Routes cheap/simple queries to fast models, complex queries to Claude Opus
# Estimated savings: ~50% on typical workloads

router:
  port: ${'{PLANO_PORT}'}
  
  # Default model for unmatched queries
  default_model: anthropic/claude-sonnet-4-20250514

  rules:
    # Simple queries: greetings, short questions, translations
    - match:
        max_tokens: 500
        patterns:
          - "^(hi|hello|hey|thanks|ok|sure)"
          - "translate"
          - "what time"
          - "remind me"
      route: moonshotai/kimi-k2.5
      reason: "Simple/short query → fast cheap model"

    # Code generation and technical queries
    - match:
        patterns:
          - "write (a |the )?(code|function|script|program)"
          - "debug|fix (this|the) (bug|error|issue)"
          - "refactor|optimize"
        min_tokens: 200
      route: anthropic/claude-sonnet-4-20250514
      reason: "Code tasks → balanced model"

    # Complex reasoning, strategy, analysis
    - match:
        patterns:
          - "analyze|analyse|strategy|plan|architect"
          - "compare .+ (and|vs|versus) .+"
          - "pros and cons"
          - "design (a |the )?(system|architecture)"
        min_tokens: 500
      route: anthropic/claude-opus-4-20250514
      reason: "Complex reasoning → best model"

    # Long-form content creation
    - match:
        patterns:
          - "write (a |an )?(blog|article|essay|report|document)"
          - "draft (a |an )?"
        min_tokens: 1000
      route: anthropic/claude-sonnet-4-20250514
      reason: "Content creation → balanced model"

    # Everything else based on estimated complexity
    - match:
        min_tokens: 2000
      route: anthropic/claude-opus-4-20250514
      reason: "Long/complex → best model"
`;

function getConfigPath() {
  return PLANO_CONFIG_PATH || path.join(process.env.HOME || '/tmp', '.plano', 'config.yaml');
}

function ensureConfigDir() {
  const dir = path.dirname(getConfigPath());
  fs.mkdirSync(dir, { recursive: true });
}

function isPlanoInstalled() {
  try {
    execSync('which plano 2>/dev/null || command -v plano 2>/dev/null', { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

function isPlanoRunning() {
  if (planoProcess && !planoProcess.killed) return true;
  try {
    const result = execSync(`lsof -i :${PLANO_PORT} -t 2>/dev/null || ss -tlnp 'sport = :${PLANO_PORT}' 2>/dev/null | grep -c LISTEN`, { encoding: 'utf8' });
    return result.trim().length > 0 && result.trim() !== '0';
  } catch {
    return false;
  }
}

export function getPlanoStatus(_req, res) {
  const installed = isPlanoInstalled();
  const running = isPlanoRunning();
  const configExists = fs.existsSync(getConfigPath());

  res.json({
    enabled: PLANO_ENABLED,
    installed,
    running,
    port: PLANO_PORT,
    configPath: getConfigPath(),
    configExists,
  });
}

export function startPlano(_req, res) {
  if (!PLANO_ENABLED) {
    return res.status(400).json({ error: 'Plano is not enabled. Set PLANO_ENABLED=true in your environment.' });
  }
  if (!isPlanoInstalled()) {
    return res.status(400).json({ error: 'Plano is not installed. Run: pip install plano-router (see https://github.com/katanemo/plano)' });
  }
  if (isPlanoRunning()) {
    return res.json({ ok: true, message: 'Plano is already running' });
  }

  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    ensureConfigDir();
    fs.writeFileSync(configPath, DEFAULT_CONFIG.replace('{PLANO_PORT}', String(PLANO_PORT)));
  }

  try {
    planoProcess = spawn('plano', ['--config', configPath, '--port', String(PLANO_PORT)], {
      detached: true,
      stdio: 'ignore',
    });
    planoProcess.unref();
    planoProcess.on('exit', () => { planoProcess = null; });

    res.json({ ok: true, message: `Plano started on port ${PLANO_PORT}`, pid: planoProcess.pid });
  } catch (e) {
    res.status(500).json({ error: `Failed to start Plano: ${e.message}` });
  }
}

export function stopPlano(_req, res) {
  if (planoProcess && !planoProcess.killed) {
    planoProcess.kill('SIGTERM');
    planoProcess = null;
    return res.json({ ok: true, message: 'Plano stopped' });
  }

  // Try to kill by port
  try {
    const pid = execSync(`lsof -i :${PLANO_PORT} -t 2>/dev/null`, { encoding: 'utf8' }).trim();
    if (pid) {
      execSync(`kill ${pid}`);
      return res.json({ ok: true, message: `Plano (pid ${pid}) stopped` });
    }
  } catch {}

  res.json({ ok: true, message: 'Plano was not running' });
}

export function getPlanoConfig(_req, res) {
  const configPath = getConfigPath();
  let config = '';
  if (fs.existsSync(configPath)) {
    config = fs.readFileSync(configPath, 'utf8');
  } else {
    config = DEFAULT_CONFIG.replace('{PLANO_PORT}', String(PLANO_PORT));
  }
  res.json({ config, path: configPath });
}

export function putPlanoConfig(req, res) {
  const { config } = req.body;
  if (!config || typeof config !== 'string') {
    return res.status(400).json({ error: 'Missing config' });
  }
  try {
    ensureConfigDir();
    fs.writeFileSync(getConfigPath(), config);
    res.json({ ok: true, message: 'Config saved. Restart Plano to apply changes.' });
  } catch (e) {
    res.status(500).json({ error: `Failed to save config: ${e.message}` });
  }
}
