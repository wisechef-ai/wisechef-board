#!/bin/bash
# Fix Issue 7: Entrypoint patch — after Paperclip starts, fix agent gateway URLs
# This script is appended to entrypoint.sh BEFORE the board exec line
#
# Reads manifest.json for the real hostname/slug, then PATCHes all agents
# in Paperclip DB to use wss://<real-hostname>/gateway

cat << 'PATCH_SCRIPT'
# === Fix agent gateway URLs (Issue 7) ===
# After Paperclip is ready, patch all agent adapter configs to use real hostname
if [ -f /opt/wisechef/manifest.json ]; then
    echo "🔧 Fixing agent gateway URLs..."
    node -e "
    const http = require('http');
    const fs = require('fs');
    
    const manifest = JSON.parse(fs.readFileSync('/opt/wisechef/manifest.json', 'utf8'));
    const hostname = manifest.hostname;
    const gatewayToken = manifest.gatewayToken || '';
    const slug = manifest.slug;
    const correctUrl = 'wss://' + hostname + '/gateway';
    const paperclipPort = process.env.PAPERCLIP_PORT || 3100;
    
    function apiCall(method, path, body) {
        return new Promise((resolve, reject) => {
            const opts = {
                hostname: '127.0.0.1', port: paperclipPort,
                path: path, method: method,
                headers: { 'Content-Type': 'application/json' }
            };
            const req = http.request(opts, (res) => {
                let data = '';
                res.on('data', d => data += d);
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch { resolve(data); }
                });
            });
            req.on('error', reject);
            if (body) req.write(JSON.stringify(body));
            req.end();
        });
    }
    
    async function fixUrls() {
        // Get all companies
        const companies = await apiCall('GET', '/api/companies');
        if (!Array.isArray(companies)) { console.log('[fix-urls] No companies yet'); return; }
        
        for (const company of companies) {
            const agents = await apiCall('GET', '/api/companies/' + company.id + '/agents');
            if (!Array.isArray(agents)) continue;
            
            for (const agent of agents) {
                const cfg = agent.adapterConfig || {};
                if (cfg.url && cfg.url !== correctUrl) {
                    console.log('[fix-urls] Patching ' + agent.name + ': ' + cfg.url + ' -> ' + correctUrl);
                    await apiCall('PATCH', '/api/agents/' + agent.id, {
                        adapterConfig: {
                            ...cfg,
                            url: correctUrl,
                            authToken: gatewayToken,
                            agentId: slug + '-' + (agent.role || 'agent'),
                        }
                    });
                } else if (!cfg.url) {
                    console.log('[fix-urls] Setting URL for ' + agent.name + ': ' + correctUrl);
                    await apiCall('PATCH', '/api/agents/' + agent.id, {
                        adapterConfig: {
                            ...cfg,
                            url: correctUrl,
                            authToken: gatewayToken,
                            agentId: slug + '-' + (agent.role || 'agent'),
                        }
                    });
                }
            }
        }
        console.log('[fix-urls] Done');
    }
    
    fixUrls().catch(e => console.error('[fix-urls] Error:', e.message));
    " 2>&1 || echo "[fix-urls] Script failed (non-fatal)"
fi
PATCH_SCRIPT
