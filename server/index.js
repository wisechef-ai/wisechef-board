import express from 'express';
import http from 'http';
import { HOST, PORT, AGENT_TYPES_ENABLED } from './config.js';
import { setupWebSocket } from './broadcast.js';
import { setupMiddleware } from './middleware.js';
import router from './routes.js';
import { mountEnterprise } from './enterprise-mount.js';

const app = express();
const server = http.createServer(app);

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
app.use(router);

if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
  console.warn(
    `[WARN] HOST is set to ${HOST}. This exposes the dashboard beyond localhost unless restricted by firewall/network policy.`
  );
}

server.listen(PORT, HOST, () => {
  console.log(`Dashboard running at http://${HOST}:${PORT}`);
});
