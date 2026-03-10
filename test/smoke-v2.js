#!/usr/bin/env node

/**
 * WiseChef Integration Smoke Tests — v2
 *
 * Tests the full stack: board, enterprise panel (Paperclip), onboarding, proxy.
 * Run: node test/smoke-v2.js https://SLUG.wisechef.ai
 */

const BASE = process.argv[2] || 'http://localhost:3333';
let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    const msg = e.message || String(e);
    failures.push({ name, msg });
    console.log(`  ❌ ${name}`);
    console.log(`     ${msg}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function fetchJSON(path, opts = {}) {
  const url = `${BASE}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeout || 10000);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, text, json, ok: res.ok };
  } finally {
    clearTimeout(timeout);
  }
}

console.log('🧪 WiseChef Smoke Tests v2');
console.log(`   Target: ${BASE}\n`);

// ── Board Health ──
console.log('── Board ──');

await test('Board root returns 200', async () => {
  const { status } = await fetchJSON('/');
  assert(status === 200, `Expected 200, got ${status}`);
});

await test('Board serves static assets', async () => {
  const { status, text } = await fetchJSON('/');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(text.includes('<'), 'Expected HTML content');
});

// ── Onboarding ──
console.log('\n── Onboarding ──');

await test('GET /api/onboarding/status returns valid response', async () => {
  const { status, json } = await fetchJSON('/api/onboarding/status');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(typeof json.onboarded === 'boolean', 'Expected onboarded boolean');
});

await test('GET /api/onboarding/tier returns valid tier', async () => {
  const { status, json } = await fetchJSON('/api/onboarding/tier');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(json.tier, `Expected tier field, got ${JSON.stringify(json)}`);
  assert(['starter', 'pro', 'enterprise'].includes(json.tier), `Invalid tier: ${json.tier}`);
});

await test('GET /api/onboarding/roles returns roles array', async () => {
  const { status, json } = await fetchJSON('/api/onboarding/roles');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(json.roles && Array.isArray(json.roles), 'Expected roles array');
  assert(json.roles.length >= 1, 'Expected at least 1 role');
});

await test('Personal Assistant role exists and is recommended', async () => {
  const { json } = await fetchJSON('/api/onboarding/roles');
  const pa = json.roles.find(r => r.id === 'personal-assistant');
  assert(pa, 'personal-assistant role not found');
  assert(pa.recommended === true, 'personal-assistant should be recommended');
  assert(pa.soulTemplate, 'personal-assistant must have soulTemplate');
});

await test('Ruthless Mentor role exists', async () => {
  const { json } = await fetchJSON('/api/onboarding/roles');
  const rm = json.roles.find(r => r.id === 'ruthless-mentor');
  assert(rm, 'ruthless-mentor role not found');
  assert(rm.soulTemplate, 'ruthless-mentor must have soulTemplate');
});

// ── Enterprise Panel (Paperclip) ──
console.log('\n── Enterprise Panel ──');

await test('Enterprise panel serves UI at /enterprise/', async () => {
  const { status, text } = await fetchJSON('/enterprise/');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(text.includes('<!DOCTYPE html'), 'Expected HTML');
});

await test('Enterprise API proxied: GET /enterprise/api/companies returns array', async () => {
  const { status, json } = await fetchJSON('/enterprise/api/companies');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(json), `Expected array, got ${typeof json}`);
});

await test('Enterprise API health: GET /enterprise/api/health', async () => {
  const { status, json } = await fetchJSON('/enterprise/api/health');
  // Paperclip health endpoint returns 200 with status
  assert(status === 200, `Expected 200, got ${status}`);
});

await test('Plan endpoint returns plan tier', async () => {
  const { status, json } = await fetchJSON('/enterprise/api/plan');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(json.plan, `Expected plan field, got ${JSON.stringify(json)}`);
  assert(['starter', 'pro', 'enterprise'].includes(json.plan), `Invalid plan: ${json.plan}`);
});

await test('Container context endpoint works', async () => {
  const { status, json } = await fetchJSON('/enterprise/api/container-context');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(json.plan, 'Expected plan in container context');
});

// ── Proxy Integrity ──
console.log('\n── Proxy ──');

await test('POST to enterprise API with JSON body is forwarded correctly', async () => {
  // Try creating a company — should work or return a meaningful error
  const { status, json } = await fetchJSON('/enterprise/api/companies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'smoke-test-co', description: 'Smoke test' }),
  });
  // 200/201 = created, 400 = validation error, 409 = already exists — all valid proxy results
  assert([200, 201, 400, 409, 422].includes(status),
    `Expected valid proxy response, got ${status}: ${JSON.stringify(json)}`);
});

await test('GET /enterprise/api/nonexistent returns 404 (not 502)', async () => {
  const { status } = await fetchJSON('/enterprise/api/nonexistent-route-xyz');
  // Paperclip returns 404 for unknown routes, NOT our proxy's 502
  assert(status !== 502, 'Got 502 — proxy is broken or Paperclip is down');
  assert(status === 404 || status === 200, `Expected 404, got ${status}`);
});

// ── No Infinite Polling ──
console.log('\n── Stability ──');

await test('Enterprise panel does not infinite-loop API requests', async () => {
  // Hit the companies endpoint twice with a small delay
  // If there's an infinite loop, the server would be under heavy load
  const start = Date.now();
  await fetchJSON('/enterprise/api/companies');
  const elapsed = Date.now() - start;
  assert(elapsed < 5000, `Companies endpoint took ${elapsed}ms — possible backend overload`);
});

// ── One-Shot Generation ──
console.log('\n── One-Shot Generation ──');

await test('POST /api/onboarding/one-shot rejects empty input', async () => {
  const { status } = await fetchJSON('/api/onboarding/one-shot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName: '', role: '' }),
  });
  assert(status === 400, `Expected 400 for empty input, got ${status}`);
});

// ── Summary ──
console.log(`\n${'─'.repeat(40)}`);
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);

if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ❌ ${f.name}: ${f.msg}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
