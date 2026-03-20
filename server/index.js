import express from 'express';
import http from 'http';
import httpProxy from 'http-proxy';
import { HOST, PORT, AGENT_TYPES_ENABLED } from './config.js';
import { setupWebSocket } from './broadcast.js';
import { setupMiddleware } from './middleware.js';
import router from './routes.js';
import { mountEnterprise } from './enterprise-mount.js';
import { startPaperclip, stopPaperclip } from './lib/paperclip.js';

const app = express();

// ── Gateway reverse proxy (TUI-first: OpenClaw Control UI as primary interface) ──
const GATEWAY_PORT = process.env.GATEWAY_PORT || 18789;
const GATEWAY_TARGET = `http://127.0.0.1:${GATEWAY_PORT}`;
const proxy = httpProxy.createProxyServer({ target: GATEWAY_TARGET, ws: true, changeOrigin: true });
proxy.on('error', (err, _req, res) => {
  console.error('[proxy] Gateway proxy error:', err.message);
  if (res.writeHead) res.writeHead(502, { 'Content-Type': 'text/plain' });
  if (res.end) res.end('Gateway unavailable');
});

const server = http.createServer(app);

// Proxy WebSocket upgrades to gateway for Control UI + chat
server.on('upgrade', (req, socket, head) => {
  // Board's own WS (socket.io for live updates) uses /socket.io/ path
  if (req.url?.startsWith('/socket.io')) return;
  // Everything else (Control UI WS) → gateway
  proxy.ws(req, socket, head);
});

// ── Stripe webhook MUST be registered before express.json() middleware ──
// It needs the raw request body for signature verification.
if (AGENT_TYPES_ENABLED) {
  const { handleStripeWebhook } = await import('./controllers/stripe.js');
  app.post(
    '/api/webhook/stripe',
    express.raw({ type: 'application/json' }),
    handleStripeWebhook,
  );
}

setupWebSocket(server);
setupMiddleware(app);
mountEnterprise(app);
app.set('gatewayProxy', proxy);
app.use(router);

if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
  console.warn(
    `[WARN] HOST is set to ${HOST}. This exposes the dashboard beyond localhost unless restricted by firewall/network policy.`
  );
}

server.listen(PORT, HOST, async () => {
  console.log(`Dashboard running at http://${HOST}:${PORT}`);
  
  // Connect to the Paperclip surface when present. Embedded mode is opt-in.
  try {
    await startPaperclip({
      port: parseInt(process.env.PAPERCLIP_PORT || '3100'),
      mode: process.env.PAPERCLIP_MODE || 'external',
      companyName: process.env.COMPANY_NAME || 'WiseChef',
      companySlug: process.env.COMPANY_SLUG || 'wisechef',
    });
  } catch (err) {
    console.warn('📎 Paperclip init skipped:', err.message);
  }
});

// Graceful shutdown
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    console.log(`\n${sig} received, shutting down...`);
    await stopPaperclip();
    server.close(() => process.exit(0));
  });
}
