import fs from 'fs';
import path from 'path';
import { __dirname } from '../config.js';

const STATUS_FILE = path.join(__dirname, 'data', 'fleet-status.json');
const REGISTRY_PATH = process.env.REGISTRY_PATH || '/home/wisechef/clawd/wisechef/clients/registry.json';
const HETZNER_API = 'https://api.hetzner.cloud/v1';

function readRegistry() {
  try { return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8')); }
  catch { return { clients: [] }; }
}

function readFleetStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')); }
  catch { return {}; }
}

function writeFleetStatus(data) {
  fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
  fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2));
}

async function hetznerRequest(path) {
  const token = process.env.HETZNER_API_TOKEN;
  if (!token) return null;
  const res = await fetch(`${HETZNER_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function checkClientHealth(client) {
  const result = {
    id: client.id,
    name: client.name,
    email: client.email,
    plan: client.plan || 'starter',
    subdomain: client.tunnel?.hostname || `${client.id}.wisechef.ai`,
    status: client.status,
    ip: client.vps?.ip,
    vpsType: client.vps?.type || 'cx22',
    createdAt: client.createdAt,
    vpsReachable: false,
    boardReachable: false,
    gatewayStatus: false,
    boardVersion: null,
    lastActive: null,
    monthlyCost: null,
  };

  // Cost estimates
  const costs = { cx22: 3.49, cx23: 3.49, cx32: 5.99, cx33: 5.99, cx42: 11.49, cx52: 21.99 };
  result.monthlyCost = costs[result.vpsType] || 3.49;

  if (!client.vps?.ip || client.status !== 'deployed') return result;

  const hostname = result.subdomain;
  const url = `https://${hostname}`;

  // Board HTTP check
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${url}/api/activity`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      result.boardReachable = true;
      const data = await res.json();
      result.lastActive = data.lastActive || data.timestamp;
    }
  } catch {}

  // Gateway status
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${url}/api/gateway/status`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      result.gatewayStatus = data.running || data.status === 'running';
    }
  } catch {}

  // Board version
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${url}/api/wisechef-board/version`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      result.boardVersion = data.sha || data.version;
    }
  } catch {}

  // VPS reachable via Hetzner API (by name)
  result.vpsReachable = result.boardReachable; // simplified: if board is up, VPS is up

  return result;
}

// Periodic health check
let healthInterval;
export function startHealthChecks(io) {
  const check = async () => {
    try {
      const registry = readRegistry();
      const deployed = registry.clients.filter(c => c.status === 'deployed');
      const results = {};
      for (const client of deployed) {
        results[client.id] = await checkClientHealth(client);
      }
      writeFleetStatus(results);
      if (io) io.emit('fleet:update', results);
    } catch (e) {
      console.error('[fleet] Health check error:', e.message);
    }
  };

  check(); // run immediately
  healthInterval = setInterval(check, 5 * 60 * 1000); // every 5 min
}

// ── Route handlers ──

export function getFleet(req, res) {
  const registry = readRegistry();
  const status = readFleetStatus();

  const clients = registry.clients.map(c => ({
    ...c,
    health: status[c.id] || null,
  }));

  res.json({ clients, lastCheck: fs.existsSync(STATUS_FILE) ? fs.statSync(STATUS_FILE).mtime.toISOString() : null });
}

export async function getClientStatus(req, res) {
  const { clientId } = req.params;
  const registry = readRegistry();
  const client = registry.clients.find(c => c.id === clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const health = await checkClientHealth(client);
  const status = readFleetStatus();
  status[clientId] = health;
  writeFleetStatus(status);

  res.json(health);
}

export async function deployClient(req, res) {
  const { clientId } = req.params;
  const registry = readRegistry();
  const client = registry.clients.find(c => c.id === clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!client.vps?.ip) return res.status(400).json({ error: 'No VPS IP for client' });

  // Trigger deploy-dashboard.sh
  const { exec } = await import('child_process');
  const scriptPath = process.env.DEPLOY_DASHBOARD_SCRIPT || '/home/wisechef/clawd/wisechef/deploy/deploy-dashboard.sh';

  exec(`bash ${scriptPath} ${clientId}`, (error, stdout, stderr) => {
    // Non-blocking — log result
    if (error) console.error(`[fleet] Deploy ${clientId} failed:`, stderr);
    else console.log(`[fleet] Deploy ${clientId} done:`, stdout.slice(-200));
  });

  res.json({ message: `Deploy triggered for ${clientId}`, status: 'in_progress' });
}
