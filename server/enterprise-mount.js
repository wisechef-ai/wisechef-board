/**
 * Enterprise Panel integration for wisechef-board — LOCAL SQLite mode.
 *
 * Instead of proxying to a central server, this starts a local Paperclip
 * server with SQLite and routes /enterprise/api/* to it.
 *
 * Usage in board's server/index.js:
 *   import { mountEnterprise } from './enterprise-mount.js';
 *   mountEnterprise(app);
 */
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTERPRISE_DIST = path.join(__dirname, '..', 'enterprise-dist');
const MANIFEST_PATH = '/opt/wisechef/manifest.json';
const LOCAL_ENTERPRISE_PORT = parseInt(process.env.PAPERCLIP_PORT || '3100', 10);

// Team agent limits per plan tier (CEO/personal assistant is FREE and doesn't count)
const TEAM_AGENT_LIMITS = {
  starter: 3,      // 3 team agents across all companies
  pro: 10,         // 10 team agents
  enterprise: 50,  // 50 team agents
};

// Read manifest for company context
function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Get all agents across all companies from the enterprise panel.
 * Returns { total, teamAgents, ceoAgents } — ceo agents are free.
 */
function getAllAgents() {
  return new Promise(async (resolve) => {
    try {
      // First get all companies
      const companies = await new Promise((res) => {
        const r = http.get(`http://127.0.0.1:${LOCAL_ENTERPRISE_PORT}/api/companies`, { timeout: 5000 }, (resp) => {
          let data = '';
          resp.on('data', chunk => data += chunk);
          resp.on('end', () => { try { res(JSON.parse(data)); } catch { res([]); } });
        });
        r.on('error', () => res([]));
        r.on('timeout', () => { r.destroy(); res([]); });
      });

      // Then get agents for each company
      let allAgents = [];
      for (const company of companies) {
        const agents = await new Promise((res) => {
          const r = http.get(`http://127.0.0.1:${LOCAL_ENTERPRISE_PORT}/api/companies/${company.id}/agents`, { timeout: 5000 }, (resp) => {
            let data = '';
            resp.on('data', chunk => data += chunk);
            resp.on('end', () => { try { res(JSON.parse(data)); } catch { res([]); } });
          });
          r.on('error', () => res([]));
          r.on('timeout', () => { r.destroy(); res([]); });
        });
        allAgents = allAgents.concat(agents);
      }

      const ceoAgents = allAgents.filter(a => a.role === 'ceo');
      const teamAgents = allAgents.filter(a => a.role !== 'ceo');

      resolve({
        total: allAgents.length,
        teamAgents: teamAgents.length,
        ceoAgents: ceoAgents.length,
      });
    } catch {
      resolve({ total: 0, teamAgents: 0, ceoAgents: 0 });
    }
  });
}

/**
 * Proxy /enterprise/api/* → local enterprise server on localhost:3100/api/*
 */
function proxyRequest(req, res) {
  const manifest = readManifest();
  const targetPath = req.originalUrl.replace(/^\/enterprise\/api/, '/api');
  const targetUrl = `http://127.0.0.1:${LOCAL_ENTERPRISE_PORT}${targetPath}`;

  // Forward headers, add company context
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['content-length']; // will be re-set when we serialize body
  headers['x-company-id'] = manifest.companyId || '';
  headers['x-gateway-token'] = manifest.gatewayToken || '';
  headers['x-company-slug'] = manifest.slug || '';
  headers['x-forwarded-for'] = req.ip || req.connection?.remoteAddress || '';

  const url = new URL(targetUrl);
  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port: LOCAL_ENTERPRISE_PORT,
      path: url.pathname + url.search,
      method: req.method,
      headers,
      timeout: 30000,
    },
    (proxyRes) => {
      const resHeaders = { ...proxyRes.headers };
      delete resHeaders['transfer-encoding'];
      res.writeHead(proxyRes.statusCode || 502, resHeaders);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('error', (err) => {
    console.error(`[enterprise-proxy] Error proxying to localhost:${LOCAL_ENTERPRISE_PORT}:`, err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Enterprise panel backend unavailable (local)' });
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.status(504).json({ error: 'Enterprise panel backend timeout' });
    }
  });

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.body && typeof req.body === 'object') {
      const bodyStr = JSON.stringify(req.body);
      proxyReq.setHeader('content-length', Buffer.byteLength(bodyStr));
      proxyReq.end(bodyStr);
    } else if (typeof req.body === 'string') {
      proxyReq.setHeader('content-length', Buffer.byteLength(req.body));
      proxyReq.end(req.body);
    } else {
      proxyReq.end();
    }
  } else {
    proxyReq.end();
  }
}

/**
 * Mount enterprise panel on an Express app.
 */
export function mountEnterprise(app) {
  if (!fs.existsSync(ENTERPRISE_DIST)) {
    console.log('[enterprise] enterprise-dist/ not found — enterprise panel disabled');
    return;
  }

  console.log('[enterprise] Mounting enterprise panel at /enterprise/ (local SQLite backend)');

  // Company context endpoint — enriches manifest with live DB data
  app.get('/enterprise/api/container-context', async (req, res) => {
    const manifest = readManifest();
    let companyId = manifest.companyId || null;
    let companyName = manifest.companyName || null;
    if (!companyId) {
      try {
        const companies = await new Promise((resolve) => {
          const r = http.get(`http://127.0.0.1:${LOCAL_ENTERPRISE_PORT}/api/companies`, { timeout: 3000 }, (resp) => {
            let data = '';
            resp.on('data', chunk => data += chunk);
            resp.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve([]); } });
          });
          r.on('error', () => resolve([]));
          r.on('timeout', () => { r.destroy(); resolve([]); });
        });
        if (companies.length > 0) {
          companyId = companies[0].id;
          companyName = companies[0].name;
        }
      } catch {}
    }
    res.json({
      companyId,
      companySlug: manifest.slug || null,
      companyName: companyName || manifest.name || null,
      gatewayToken: manifest.gatewayToken || null,
      boardUrl: `https://${manifest.slug || 'unknown'}.wisechef.ai`,
    });
  });

  // Provisioning status endpoint — tells the Personal Assistant view
  // that this container is running and healthy
  app.get('/api/provisioning/company/:companyId/status', async (req, res) => {
    const manifest = readManifest();
    const slug = manifest.slug || 'unknown';
    const { total } = await getAllAgents();
    res.json({
      running: true,
      healthy: true,
      hostname: `${slug}.wisechef.ai`,
      agentCount: total,
      plan: process.env.WISECHEF_PLAN || 'starter',
    });
  });

  // Plan tier endpoint — returns limits and current usage for frontend
  app.get('/enterprise/api/plan', async (req, res) => {
    const plan = (process.env.WISECHEF_PLAN || 'starter').toLowerCase();
    const limit = TEAM_AGENT_LIMITS[plan] || TEAM_AGENT_LIMITS.starter;
    const { teamAgents, ceoAgents } = await getAllAgents();
    res.json({
      plan,
      teamAgentLimit: limit,
      teamAgentsUsed: teamAgents,
      teamAgentsRemaining: Math.max(0, limit - teamAgents),
      ceoAgents,
      // Legacy compat
      agentLimit: limit,
    });
  });

  // Agent limit enforcement — intercept POST to create agents
  // CEO role doesn't count toward the limit; limit is GLOBAL across all companies
  app.post('/enterprise/api/companies/:companyId/agents', async (req, res, next) => {
    const plan = (process.env.WISECHEF_PLAN || 'starter').toLowerCase();
    const limit = TEAM_AGENT_LIMITS[plan] || TEAM_AGENT_LIMITS.starter;
    const incomingRole = req.body?.role || '';

    // CEO/personal-assistant agents are free — always allow
    if (incomingRole === 'ceo') {
      return proxyRequest(req, res);
    }

    // Count team agents globally (across all companies, excluding CEOs)
    const { teamAgents } = await getAllAgents();
    if (teamAgents >= limit) {
      return res.status(403).json({
        error: 'Agent limit reached',
        message: `Your ${plan} plan allows up to ${limit} team agent(s). You have ${teamAgents}. Upgrade your plan to add more.`,
        plan,
        limit,
        used: teamAgents,
        remaining: 0,
      });
    }

    // Within limit — forward to enterprise panel
    proxyRequest(req, res);
  });

  // API proxy to local enterprise server (all other routes)
  app.all('/enterprise/api/*', proxyRequest);

  // Static files — short cache for HTML (so patches take effect fast), long for assets
  app.use('/enterprise', express.static(ENTERPRISE_DIST, {
    maxAge: '1h',
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
    index: 'index.html',
  }));

  // SPA fallback
  app.get('/enterprise/*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(ENTERPRISE_DIST, 'index.html'));
  });

  app.get('/enterprise', (req, res) => {
    res.redirect(301, '/enterprise/');
  });
}
