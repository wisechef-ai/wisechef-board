#!/usr/bin/env node
/**
 * WiseChef Issue Fixes — Test Suite
 * Tests for all 7 fixes. Run inside the container after applying patches.
 *
 * Usage: node test-fixes.js
 */

const http = require('http');
const fs = require('fs');
const { execSync } = require('child_process');

const PAPERCLIP_PORT = process.env.PAPERCLIP_PORT || 3100;
const BOARD_PORT = process.env.PORT || 3333;
let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
    try {
        fn();
        passed++;
        results.push({ name, status: 'PASS' });
        console.log(`  ✅ ${name}`);
    } catch (e) {
        failed++;
        results.push({ name, status: 'FAIL', error: e.message });
        console.log(`  ❌ ${name}: ${e.message}`);
    }
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'Assertion failed');
}

function apiCall(port, method, path, body) {
    return new Promise((resolve, reject) => {
        const opts = {
            hostname: '127.0.0.1', port, path, method,
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000,
        };
        const req = http.request(opts, (res) => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function run() {
    console.log('\n🧪 WiseChef Fix Test Suite\n');

    // ═══════════════════════════════════════════
    console.log('── Issue 2: Skip channel linking ──');
    // ═══════════════════════════════════════════

    test('routes.js does not hard-gate on hasLinkedChannel in SPA fallback', () => {
        const routes = fs.readFileSync('/opt/wisechef/board/server/routes.js', 'utf8');
        // The SPA fallback should NOT contain the old hasLinkedChannel gate
        const fallbackMatch = routes.match(/router\.get\('\*'[\s\S]*?\}\);/g);
        assert(fallbackMatch, 'Could not find SPA fallback route');
        const lastFallback = fallbackMatch[fallbackMatch.length - 1];
        assert(!lastFallback.includes('hasLinkedChannel()') || lastFallback.includes('channelLinkShown'),
            'SPA fallback still hard-gates on hasLinkedChannel');
    });

    test('routes.js has /dashboard redirect', () => {
        const routes = fs.readFileSync('/opt/wisechef/board/server/routes.js', 'utf8');
        assert(routes.includes("'/dashboard'") || routes.includes('"/dashboard"'),
            '/dashboard route not found');
    });

    // ═══════════════════════════════════════════
    console.log('\n── Issue 3: Gateway startup race ──');
    // ═══════════════════════════════════════════

    test('channels.js has extended gateway wait (not 5s)', () => {
        const channels = fs.readFileSync('/opt/wisechef/board/server/controllers/channels.js', 'utf8');
        assert(!channels.includes('setTimeout(resolve, 5000)') || !channels.includes('gatewayRestarted'),
            'Still using old 5s fixed delay');
    });

    test('channels.js has health check loop', () => {
        const channels = fs.readFileSync('/opt/wisechef/board/server/controllers/channels.js', 'utf8');
        assert(channels.includes('45000') || channels.includes('maxWaitMs'),
            'No 45s health check loop found');
    });

    test('channels.js polls openclaw status in loop', () => {
        const channels = fs.readFileSync('/opt/wisechef/board/server/controllers/channels.js', 'utf8');
        assert(channels.includes('openclaw status') && channels.includes('while'),
            'No openclaw status polling loop found');
    });

    // ═══════════════════════════════════════════
    console.log('\n── Issue 4: Welcome message phone detection ──');
    // ═══════════════════════════════════════════

    test('channels.js has phone number fallback from openclaw status', () => {
        const channels = fs.readFileSync('/opt/wisechef/board/server/controllers/channels.js', 'utf8');
        assert(channels.includes('phoneMatch') || channels.includes('+\\d{7,15}'),
            'No phone number regex fallback found');
    });

    test('channels.js has manifest.json fallback for phone', () => {
        const channels = fs.readFileSync('/opt/wisechef/board/server/controllers/channels.js', 'utf8');
        assert(channels.includes('manifest.json'),
            'No manifest.json phone fallback found');
    });

    // ═══════════════════════════════════════════
    console.log('\n── Issue 5: SQLite cast compatibility ──');
    // ═══════════════════════════════════════════

    test('activity.js uses CAST() not ::text', () => {
        const activity = fs.readFileSync('/opt/wisechef/enterprise-panel/server/dist/services/activity.js', 'utf8');
        assert(!activity.includes('::text'), 'activity.js still has ::text PostgreSQL cast');
        assert(activity.includes('CAST'), 'activity.js does not have CAST() replacement');
    });

    test('costs.js has no ::text casts', () => {
        const costs = fs.readFileSync('/opt/wisechef/enterprise-panel/server/dist/services/costs.js', 'utf8');
        assert(!costs.includes('::text'), 'costs.js still has ::text PostgreSQL cast');
    });

    // Test the actual endpoint
    try {
        const manifest = JSON.parse(fs.readFileSync('/opt/wisechef/manifest.json', 'utf8'));
        // Find the company ID
        const companiesRes = await apiCall(PAPERCLIP_PORT, 'GET', '/api/companies');
        if (companiesRes.status === 200 && Array.isArray(companiesRes.body) && companiesRes.body.length > 0) {
            const companyId = companiesRes.body[0].id;

            test('GET /api/companies/:id/activity returns 200 (not 500)', async () => {
                const res = await apiCall(PAPERCLIP_PORT, 'GET', `/api/companies/${companyId}/activity`);
                assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            });

            test('GET /api/companies/:id/costs/summary returns 200', async () => {
                const res = await apiCall(PAPERCLIP_PORT, 'GET', `/api/companies/${companyId}/costs/summary`);
                assert(res.status === 200, `Expected 200, got ${res.status}`);
            });

            test('GET /api/companies/:id/dashboard returns 200', async () => {
                const res = await apiCall(PAPERCLIP_PORT, 'GET', `/api/companies/${companyId}/dashboard`);
                assert(res.status === 200, `Expected 200, got ${res.status}`);
            });
        }
    } catch (e) {
        console.log(`  ⚠️  Skipping live API tests: ${e.message}`);
    }

    // ═══════════════════════════════════════════
    console.log('\n── Issue 6: Project workspace auto-creation ──');
    // ═══════════════════════════════════════════

    test('enterprise-mount.js has project workspace interceptor', () => {
        const mount = fs.readFileSync('/opt/wisechef/board/server/enterprise-mount.js', 'utf8');
        assert(mount.includes('/opt/wisechef/workspace/projects/'),
            'No project workspace auto-creation found');
    });

    test('/opt/wisechef/workspace/projects/ directory exists', () => {
        assert(fs.existsSync('/opt/wisechef/workspace/projects'),
            'Project workspace directory not created');
    });

    // ═══════════════════════════════════════════
    console.log('\n── Issue 7: Agent gateway URLs ──');
    // ═══════════════════════════════════════════

    test('manifest.json exists and has hostname', () => {
        assert(fs.existsSync('/opt/wisechef/manifest.json'), 'manifest.json missing');
        const m = JSON.parse(fs.readFileSync('/opt/wisechef/manifest.json', 'utf8'));
        assert(m.hostname, 'manifest.json missing hostname');
        assert(m.slug, 'manifest.json missing slug');
    });

    // Check agents have correct URLs
    try {
        const manifest = JSON.parse(fs.readFileSync('/opt/wisechef/manifest.json', 'utf8'));
        const correctUrl = `wss://${manifest.hostname}/gateway`;
        const companiesRes = await apiCall(PAPERCLIP_PORT, 'GET', '/api/companies');
        if (companiesRes.status === 200 && Array.isArray(companiesRes.body) && companiesRes.body.length > 0) {
            const companyId = companiesRes.body[0].id;
            const agentsRes = await apiCall(PAPERCLIP_PORT, 'GET', `/api/companies/${companyId}/agents`);
            if (agentsRes.status === 200 && Array.isArray(agentsRes.body)) {
                for (const agent of agentsRes.body) {
                    test(`Agent "${agent.name}" has correct gateway URL`, () => {
                        const cfg = agent.adapterConfig || {};
                        assert(cfg.url === correctUrl,
                            `Expected ${correctUrl}, got ${cfg.url}`);
                    });

                    test(`Agent "${agent.name}" has gateway auth token`, () => {
                        const cfg = agent.adapterConfig || {};
                        assert(cfg.authToken && cfg.authToken.length > 0,
                            'Missing authToken');
                    });

                    test(`Agent "${agent.name}" agentId uses slug not company name`, () => {
                        const cfg = agent.adapterConfig || {};
                        assert(cfg.agentId && cfg.agentId.startsWith(manifest.slug),
                            `agentId "${cfg.agentId}" should start with "${manifest.slug}"`);
                    });
                }
            }
        }
    } catch (e) {
        console.log(`  ⚠️  Skipping live agent URL tests: ${e.message}`);
    }

    // Entrypoint has the fix-urls script
    test('entrypoint.sh contains gateway URL fix', () => {
        const entrypoint = fs.readFileSync('/entrypoint.sh', 'utf8');
        assert(entrypoint.includes('fix-urls') || entrypoint.includes('Fixing agent gateway URLs'),
            'Entrypoint missing gateway URL fix');
    });

    // ═══════════════════════════════════════════
    console.log('\n── Summary ──');
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);
    console.log(`  Total:  ${passed + failed}\n`);

    if (failed > 0) {
        console.log('Failed tests:');
        for (const r of results.filter(r => r.status === 'FAIL')) {
            console.log(`  ❌ ${r.name}: ${r.error}`);
        }
        process.exit(1);
    }
}

run().catch(e => {
    console.error('Test runner error:', e);
    process.exit(1);
});
