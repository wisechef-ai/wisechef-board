// ═══════════════════════════════════════════════════════════════
// OpenRouter Management API — Per-client key provisioning
// ═══════════════════════════════════════════════════════════════
//
// Uses a Management API key to create per-client API keys with
// monthly spend limits. Each WiseChef client gets their own
// isolated OpenRouter key.
//
// Docs: https://openrouter.ai/docs/api/api-reference/api-keys
// ═══════════════════════════════════════════════════════════════

const BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Get the management key from env.
 * This key is ONLY for creating/managing other keys — never used for inference.
 */
function getManagementKey() {
  const key = process.env.OPENROUTER_MANAGEMENT_KEY;
  if (!key) throw new Error('OPENROUTER_MANAGEMENT_KEY not set — cannot provision client keys');
  return key;
}

// Monthly spend limits per plan (USD)
// All plans use claude-sonnet-4.6 (~$0.0165/msg)
// 720 msgs/mo max (50 cap + 1/hr recharge) = ~$12 worst case
// Adding buffer for system prompts and retries
const PLAN_LIMITS = {
  starter:    15,
  pro:        15,
  enterprise: 15,
};

/**
 * Create a per-client OpenRouter API key with monthly spend limit.
 *
 * @param {string} slug - Client slug (e.g. "mariusz-krawk7x")
 * @param {string} plan - starter|pro|enterprise
 * @returns {Promise<{key: string, hash: string, name: string, limit: number}>}
 */
export async function createClientKey(slug, plan = 'starter') {
  const managementKey = getManagementKey();
  const limit = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;

  const res = await fetch(`${BASE_URL}/keys`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${managementKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: `wisechef-${slug}`,
      limit,
      limit_reset: 'monthly',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter key creation failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  // API returns: { key: "sk-or-...", data: { hash, name, limit, ... } }
  // The actual key string is at top level, metadata inside .data
  return {
    key: data.key,
    hash: data.data.hash,
    name: data.data.name,
    limit: data.data.limit,
  };
}

/**
 * List all managed client keys (for admin dashboard).
 * @returns {Promise<Array>}
 */
export async function listClientKeys() {
  const managementKey = getManagementKey();

  const res = await fetch(`${BASE_URL}/keys`, {
    headers: { 'Authorization': `Bearer ${managementKey}` },
  });

  if (!res.ok) return [];
  const data = await res.json();
  return data.data || [];
}

/**
 * Delete a client key by hash (for deprovisioning).
 * @param {string} hash - Key hash from createClientKey()
 */
export async function deleteClientKey(hash) {
  const managementKey = getManagementKey();

  const res = await fetch(`${BASE_URL}/keys/${hash}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${managementKey}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter key deletion failed (${res.status}): ${body}`);
  }

  return true;
}

/**
 * Update a client key's spend limit (e.g. on plan change).
 * @param {string} hash - Key hash
 * @param {object} updates - { limit?: number, name?: string }
 */
export async function updateClientKey(hash, updates) {
  const managementKey = getManagementKey();

  const res = await fetch(`${BASE_URL}/keys/${hash}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${managementKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter key update failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.data;
}
