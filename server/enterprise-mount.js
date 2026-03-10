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

// Agent limits per plan tier (includes the auto-created CEO/personal assistant)
const AGENT_LIMITS = {
  starter: 1,     // CEO only
  pro: 4,         // CEO + 3
  enterprise: 20, // CEO + 19
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
 * Get current agent count for a company from the enterprise panel.
 * Returns a promise that resolves to the count.
 */
function getAgentCount(companyId) {
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${LOCAL_ENTERPRISE_PORT}/api/companies/${companyId}/agents`,
      { timeout: 5000 },
      (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data).length); }
          catch { resolve(0); }
        });
      }
    );
    req.on('error', () => resolve(0));
    req.on('timeout', () => { req.destroy(); resolve(0); });
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
    // express.json() has already consumed the raw body stream,
    // so we must re-serialize req.body instead of piping
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

  // Company context endpoint
  app.get('/enterprise/api/container-context', (req, res) => {
    const manifest = readManifest();
    res.json({
      companyId: manifest.companyId || null,
      companySlug: manifest.slug || null,
      companyName: manifest.companyName || null,
      gatewayToken: manifest.gatewayToken || null,
      boardUrl: `https://${manifest.slug || 'unknown'}.wisechef.ai`,
    });
  });

  // Plan tier endpoint (for frontend to show limits)
  app.get('/enterprise/api/plan', (req, res) => {
    const plan = (process.env.WISECHEF_PLAN || 'starter').toLowerCase();
    const limit = AGENT_LIMITS[plan] || AGENT_LIMITS.starter;
    res.json({ plan, agentLimit: limit });
  });

  // Agent limit enforcement — intercept POST to create agents
  app.post('/enterprise/api/companies/:companyId/agents', async (req, res, next) => {
    const plan = (process.env.WISECHEF_PLAN || 'starter').toLowerCase();
    const limit = AGENT_LIMITS[plan] || AGENT_LIMITS.starter;
    const companyId = req.params.companyId;

    const currentCount = await getAgentCount(companyId);
    if (currentCount >= limit) {
      return res.status(403).json({
        error: 'Agent limit reached',
        message: `Your ${plan} plan allows up to ${limit} agent(s). Upgrade your plan to add more.`,
        plan,
        limit,
        current: currentCount,
      });
    }

    // Within limit — forward to enterprise panel
    proxyRequest(req, res);
  });

  // API proxy to local enterprise server (all other routes)
  app.all('/enterprise/api/*', proxyRequest);

  // Static files
  app.use('/enterprise', express.static(ENTERPRISE_DIST, {
    maxAge: '1h',
    index: 'index.html',
  }));

  // SPA fallback
  app.get('/enterprise/*', (req, res) => {
    res.sendFile(path.join(ENTERPRISE_DIST, 'index.html'));
  });

  app.get('/enterprise', (req, res) => {
    res.redirect(301, '/enterprise/');
  });
}
