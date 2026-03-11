/**
 * Enterprise Panel integration for wisechef-board — clean proxy mode.
 *
 * Routes /enterprise/api/* → local Paperclip server on localhost:3100/api/*
 * Serves /enterprise/* static files from enterprise-dist/
 *
 * No badge injection, no agent limit enforcement, no custom bootstrap.
 * Paperclip handles its own DB, UI, and agent management natively.
 */
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import http from 'http';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTERPRISE_DIST = path.join(__dirname, '..', 'enterprise-dist');
const MANIFEST_PATH = '/opt/wisechef/manifest.json';
const LOCAL_ENTERPRISE_PORT = parseInt(process.env.PAPERCLIP_PORT || '3100', 10);

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Proxy /enterprise/api/* → local Paperclip on localhost:3100/api/*
 */
function proxyRequest(req, res) {
  const manifest = readManifest();
  const targetPath = req.originalUrl.replace(/^\/enterprise\/api/, '/api');
  const url = new URL(`http://127.0.0.1:${LOCAL_ENTERPRISE_PORT}${targetPath}`);

  const headers = { ...req.headers };
  delete headers.host;
  delete headers['content-length'];
  headers['x-company-id'] = manifest.companyId || '';
  headers['x-gateway-token'] = manifest.gatewayToken || '';
  headers['x-company-slug'] = manifest.slug || '';
  headers['x-forwarded-for'] = req.ip || req.connection?.remoteAddress || '';

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
    console.error(`[enterprise-proxy] Error:`, err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Enterprise panel backend unavailable' });
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

  console.log('[enterprise] Mounting enterprise panel at /enterprise/ (Paperclip native)');

  // Plan info endpoint — lightweight, returns plan tier for the UI
  app.get('/enterprise/api/plan', (req, res) => {
    const plan = (process.env.WISECHEF_PLAN || 'starter').toLowerCase();
    res.json({ plan });
  });

  // Container context — minimal, for PA view
  app.get('/enterprise/api/container-context', (req, res) => {
    const manifest = readManifest();
    res.json({
      companySlug: manifest.slug || null,
      companyName: manifest.companyName || manifest.name || null,
      boardUrl: `https://${manifest.slug || 'unknown'}.wisechef.ai`,
      plan: process.env.WISECHEF_PLAN || 'starter',
    });
  });

  // Intercept agent create/update to fix gateway URLs
  // All agents in this container connect locally to the OpenClaw gateway.
  // Each company gets its own OpenClaw agent (company-<companyId>) for workspace isolation.
  app.use('/enterprise/api', (req, res, next) => {
    if ((req.method === 'POST' || req.method === 'PATCH') && req.body) {
      const manifest = readManifest();
      const gatewayToken = manifest.gatewayToken || '';

      // Extract companyId from URL patterns like /api/companies/:id/agents
      const companyMatch = req.originalUrl.match(/\/companies\/([a-f0-9-]+)\//);
      const companyId = companyMatch ? companyMatch[1] : null;
      const agentId = companyId ? `company-${companyId}` : 'main';

      if (req.body.adapterConfig) {
        req.body.adapterConfig.url = 'ws://localhost:18789/gateway';
        req.body.adapterConfig.authToken = gatewayToken;
        req.body.adapterConfig.agentId = agentId;
      }
      // Also fix if adapterType is openclaw_gateway but no config yet
      if (req.body.adapterType === 'openclaw_gateway' && !req.body.adapterConfig) {
        req.body.adapterConfig = {
          url: 'ws://localhost:18789/gateway',
          authToken: gatewayToken,
          agentId: agentId,
        };
      }

      // If a new company agent is created at runtime, schedule sync-agents
      // to register it with OpenClaw (non-blocking)
      if (req.method === 'POST' && companyId && req.originalUrl.includes('/agents')) {
        setTimeout(() => {
          try {
            execSync('node /opt/wisechef/board/docker/sync-agents.js', {
              timeout: 15000,
              env: { ...process.env, GATEWAY_TOKEN: gatewayToken },
              stdio: 'pipe',
            });
            // Restart gateway to pick up new agent
            execSync('fuser -k 18789/tcp 2>/dev/null; sleep 1; nohup openclaw gateway run > /var/log/openclaw-gateway.log 2>&1 &', {
              timeout: 10000,
              stdio: 'pipe',
              shell: '/bin/bash',
            });
            console.log('[enterprise-proxy] Synced new agent for company ' + companyId);
          } catch (e) {
            console.error('[enterprise-proxy] sync-agents failed:', e.message);
          }
        }, 2000); // Small delay to let the POST complete first
      }
    }
    next();
  });

  // API proxy — all /enterprise/api/* → Paperclip
  app.all('/enterprise/api/*', proxyRequest);

  // Static files with proper caching
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
