/**
 * Enterprise Panel integration for wisechef-board.
 *
 * Serves the Paperclip enterprise UI at /enterprise/ and proxies
 * /enterprise/api/* to the central Paperclip server (dev.wisechef.ai).
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
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTERPRISE_DIST = path.join(__dirname, '..', 'enterprise-dist');
const MANIFEST_PATH = '/opt/wisechef/manifest.json';
const ENTERPRISE_API_URL = process.env.ENTERPRISE_API_URL || 'https://dev.wisechef.ai';

// Read manifest for company context
function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Lightweight reverse proxy for /enterprise/api/* → central server /api/*
 * Adds company auth headers from manifest.
 */
function proxyRequest(req, res) {
  const manifest = readManifest();
  const targetPath = req.originalUrl.replace(/^\/enterprise\/api/, '/api');
  const targetUrl = new URL(targetPath, ENTERPRISE_API_URL);

  const isHttps = targetUrl.protocol === 'https:';
  const client = isHttps ? https : http;

  // Forward headers, add company context
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['content-length']; // will be re-set when we serialize body
  headers['x-company-id'] = manifest.companyId || '';
  headers['x-gateway-token'] = manifest.gatewayToken || '';
  headers['x-company-slug'] = manifest.slug || '';
  headers['x-forwarded-for'] = req.ip || req.connection?.remoteAddress || '';

  const proxyReq = client.request(
    targetUrl.href,
    {
      method: req.method,
      headers,
      timeout: 30000,
    },
    (proxyRes) => {
      // Forward status + headers
      const resHeaders = { ...proxyRes.headers };
      // Remove hop-by-hop headers
      delete resHeaders['transfer-encoding'];

      res.writeHead(proxyRes.statusCode || 502, resHeaders);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('error', (err) => {
    console.error(`[enterprise-proxy] Error proxying to ${targetUrl.href}:`, err.message);
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

  // Pipe request body
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
  // Check if enterprise-dist exists
  if (!fs.existsSync(ENTERPRISE_DIST)) {
    console.log('[enterprise] enterprise-dist/ not found — enterprise panel disabled');
    return;
  }

  console.log('[enterprise] Mounting enterprise panel at /enterprise/');

  // Company context endpoint — tells the enterprise UI which company this container belongs to
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

  // API proxy MUST come before static files
  app.all('/enterprise/api/*', proxyRequest);

  // Static files
  app.use('/enterprise', express.static(ENTERPRISE_DIST, {
    maxAge: '1h',
    index: 'index.html',
  }));

  // SPA fallback — all /enterprise/* routes serve index.html
  app.get('/enterprise/*', (req, res) => {
    res.sendFile(path.join(ENTERPRISE_DIST, 'index.html'));
  });

  // Redirect /enterprise (no trailing slash) to /enterprise/
  app.get('/enterprise', (req, res) => {
    res.redirect(301, '/enterprise/');
  });
}
