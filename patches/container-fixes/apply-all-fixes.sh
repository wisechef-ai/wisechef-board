#!/bin/bash
# apply-all-fixes.sh — Apply all 7 WiseChef fixes inside a running container
# Usage: docker exec <container> bash /tmp/fixes/apply-all-fixes.sh
set -e

echo "═══════════════════════════════════════"
echo "  WiseChef — Applying all 7 fixes"
echo "═══════════════════════════════════════"
echo ""

FIXES_DIR="$(cd "$(dirname "$0")" && pwd)"

# ─── Issue 5: SQLite cast fix ───
echo "🔧 Issue 5: Patching PostgreSQL casts for SQLite..."
node "$FIXES_DIR/fix-5-sqlite-casts.js"
echo ""

# ─── Issue 2: Skip channel linking ───
echo "🔧 Issue 2: Making channel linking optional..."
node "$FIXES_DIR/fix-2-skip-channel.js"
echo ""

# ─── Issues 3 & 4: Gateway race + welcome message ───
echo "🔧 Issues 3 & 4: Gateway health check + welcome message phone detection..."
node "$FIXES_DIR/fix-3-4-channels.js"
echo ""

# ─── Issue 6: Project workspace auto-creation ───
echo "🔧 Issue 6: Project workspace auto-creation..."
node "$FIXES_DIR/fix-6-project-path.js"
echo ""

# ─── Issue 7: Entrypoint gateway URL fix ───
echo "🔧 Issue 7: Installing new entrypoint..."
cp "$FIXES_DIR/entrypoint.sh" /entrypoint.sh
chmod +x /entrypoint.sh
echo "[fix-7] Entrypoint replaced"
echo ""

# ─── Issue 7 (immediate): Fix agent URLs right now ───
echo "🔧 Issue 7: Fixing agent gateway URLs now..."
if [ -f /opt/wisechef/manifest.json ]; then
    node -e "
    const http = require('http');
    const fs = require('fs');
    const manifest = JSON.parse(fs.readFileSync('/opt/wisechef/manifest.json', 'utf8'));
    const hostname = manifest.hostname;
    const gatewayToken = manifest.gatewayToken || '';
    const slug = manifest.slug;
    const correctUrl = 'wss://' + hostname + '/gateway';
    const port = process.env.PAPERCLIP_PORT || 3100;

    function api(method, path, body) {
        return new Promise((resolve, reject) => {
            const req = http.request({ hostname:'127.0.0.1', port, path, method, headers:{'Content-Type':'application/json'}, timeout:10000 }, res => {
                let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d))}catch{resolve(d)} });
            });
            req.on('error', reject);
            if(body) req.write(JSON.stringify(body));
            req.end();
        });
    }

    async function fix() {
        const companies = await api('GET', '/api/companies');
        if (!Array.isArray(companies)) { console.log('[fix-urls] No companies'); return; }
        let n = 0;
        for (const co of companies) {
            const agents = await api('GET', '/api/companies/' + co.id + '/agents');
            if (!Array.isArray(agents)) continue;
            for (const a of agents) {
                const cfg = a.adapterConfig || {};
                if (cfg.url !== correctUrl || cfg.authToken !== gatewayToken) {
                    await api('PATCH', '/api/agents/' + a.id, {
                        adapterConfig: { ...cfg, url: correctUrl, authToken: gatewayToken, agentId: slug + '-' + (a.role||'agent') }
                    });
                    n++;
                }
            }
        }
        console.log('[fix-urls] Patched ' + n + ' agents → ' + correctUrl);
    }
    fix().catch(e => console.error(e.message));
    "
else
    echo "[fix-urls] No manifest.json — skipping (will fix on next container restart)"
fi
echo ""

# ─── Create project workspace dir (Issue 6) ───
mkdir -p /opt/wisechef/workspace/projects

# ─── Copy test suite ───
cp "$FIXES_DIR/test-fixes.js" /opt/wisechef/test-fixes.js

echo ""
echo "═══════════════════════════════════════"
echo "  All fixes applied! Running tests..."
echo "═══════════════════════════════════════"
echo ""

# Run tests
node /opt/wisechef/test-fixes.js
