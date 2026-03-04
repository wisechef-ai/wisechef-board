import Stripe from 'stripe';
import fs from 'fs';
import path from 'path';
import { WORKSPACE } from '../config.js';

// ──── Stripe webhook handler for wisechef-board ────
//
// This handler receives Stripe events forwarded to the client's board instance.
// Currently handles: checkout.session.completed
//
// Stripe webhook secret: STRIPE_WEBHOOK_SECRET env var (board .env)
// Stripe secret key:     STRIPE_SECRET_KEY env var (board .env)
//
// Dev VPS: webhook registered at https://dev.wisechef.ai/api/webhook/stripe

const MANIFEST_PATH = '/opt/wisechef/manifest.json';
const BATTERY_DIR = path.join(process.env.HOME || '/root', '.openclaw');

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function updateManifest(updates) {
  const manifest = readManifest();
  const updated = { ...manifest, ...updates };
  try {
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(updated, null, 2));
  } catch (err) {
    console.error('Failed to update manifest:', err);
  }
}

function updateBatteryPlan(plan) {
  const batteryFile = path.join(BATTERY_DIR, 'battery.json');
  try {
    const battery = JSON.parse(fs.readFileSync(batteryFile, 'utf8'));
    battery.plan = plan;
    fs.writeFileSync(batteryFile, JSON.stringify(battery, null, 2));
  } catch {
    // Battery file may not exist yet — that's fine, it'll be created on first chat
  }
}

/**
 * POST /api/webhook/stripe (raw body, pre-verified by Stripe)
 *
 * Note: Express must NOT parse this route with json() middleware.
 * Use express.raw({ type: 'application/json' }) on this route only.
 */
export async function handleStripeWebhook(req, res) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    console.error('[webhook] STRIPE_SECRET_KEY not set');
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  const stripe = new Stripe(secretKey);

  // Verify signature
  let event;
  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers['stripe-signature'],
        webhookSecret,
      );
    } else {
      // Dev mode without webhook secret — parse raw body directly
      console.warn('[webhook] No STRIPE_WEBHOOK_SECRET set — skipping signature verification (dev only)');
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[webhook] Received event: ${event.type}`);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const plan = session.metadata?.plan || 'starter';

      console.log(`[webhook] checkout.session.completed — plan: ${plan}, customer: ${session.customer}`);

      // Update manifest with Stripe IDs and plan
      updateManifest({
        plan,
        stripeCustomerId: session.customer || null,
        stripeSubscriptionId: session.subscription || null,
        paidAt: new Date().toISOString(),
      });

      // Sync battery to new plan
      updateBatteryPlan(plan);
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const plan = sub.metadata?.plan || 'starter';
      console.log(`[webhook] subscription.updated — plan: ${plan}`);
      updateManifest({ plan });
      updateBatteryPlan(plan);
      break;
    }

    case 'customer.subscription.deleted': {
      console.log('[webhook] subscription.deleted — downgrading to starter');
      updateManifest({ plan: 'starter', subscriptionCancelledAt: new Date().toISOString() });
      updateBatteryPlan('starter');
      break;
    }

    default:
      console.log(`[webhook] Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
}
