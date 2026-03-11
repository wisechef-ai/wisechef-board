// Fix Issue 1: Chef as board member, not CEO
// - Auto-seeded agent becomes "Chef" with role "assistant" (not "CEO" with role "ceo")
// - Assistant role is free (doesn't count toward agent limits, like CEO)
// - Enterprise team wizard stays intact — creates real CEO + team for each company
//
// Files modified:
// 1. /entrypoint.sh — change agent seed from ceo to assistant
// 2. /opt/wisechef/board/server/enterprise-mount.js — exempt assistant from limits

const fs = require('fs');

// ─── 1. Patch entrypoint.sh: CEO → Chef (assistant) ───
const ENTRYPOINT = '/entrypoint.sh';
let entrypoint = fs.readFileSync(ENTRYPOINT, 'utf8');

// The entrypoint doesn't currently auto-seed agents via API — that was done during
// provisioning. But the Issue 7 fix reads agents and patches URLs.
// We need to add a section that ensures the main agent has role "assistant" not "ceo",
// and name "Chef" not "CEO".

// Add agent rename logic after the fix-urls section
const fixUrlsEnd = "fixUrls().catch(e => console.error('[fix-urls] Error:', e.message));";
const chefPatch = `
        // === Issue 1: Ensure main agent is "Chef" (assistant), not "CEO" ===
        async function ensureChefRole() {
            const companies = await apiCall('GET', '/api/companies');
            if (!Array.isArray(companies)) return;
            
            for (const company of companies) {
                const agents = await apiCall('GET', '/api/companies/' + company.id + '/agents');
                if (!Array.isArray(agents)) continue;
                
                // Find the main gateway agent (the one with our slug in agentId)
                for (const agent of agents) {
                    const cfg = agent.adapterConfig || {};
                    const isMainAgent = cfg.agentId && cfg.agentId.endsWith('-ceo');
                    
                    if (isMainAgent && agent.role === 'ceo') {
                        // Rename to Chef, change role to assistant
                        console.log('[chef] Upgrading ' + agent.name + ' → Chef (assistant)');
                        await apiCall('PATCH', '/api/agents/' + agent.id, {
                            name: 'Chef',
                            role: 'assistant',
                            title: 'Personal Assistant',
                        });
                        // Also update agentId from slug-ceo to slug-chef
                        await apiCall('PATCH', '/api/agents/' + agent.id, {
                            adapterConfig: {
                                ...cfg,
                                agentId: cfg.agentId.replace(/-ceo$/, '-chef'),
                            }
                        });
                    }
                }
            }
            console.log('[chef] Done');
        }
        
        ensureChefRole().catch(e => console.error('[chef] Error:', e.message));`;

if (entrypoint.includes(fixUrlsEnd)) {
    entrypoint = entrypoint.replace(
        fixUrlsEnd,
        fixUrlsEnd + '\n' + chefPatch
    );
    fs.writeFileSync(ENTRYPOINT, entrypoint);
    console.log('[fix-1] Patched entrypoint — Chef role upgrade on boot');
} else {
    console.error('[fix-1] Could not find fixUrls end in entrypoint');
}

// ─── 2. Patch enterprise-mount.js: exempt assistant from limits ───
const MOUNT_JS = '/opt/wisechef/board/server/enterprise-mount.js';
let mount = fs.readFileSync(MOUNT_JS, 'utf8');
const original = mount;

// Current code exempts role === 'ceo' from limits. Add 'assistant' too.
// Pattern: role === 'ceo' → role === 'ceo' || role === 'assistant'
mount = mount.replace(
    /role\s*===\s*['"]ceo['"]/g,
    "role === 'ceo' || role === 'assistant'"
);

// Also update the VALID_TYPES if it exists in onboardingOneShot.js
const ONBOARDING_JS = '/opt/wisechef/board/server/controllers/onboardingOneShot.js';
try {
    let onboarding = fs.readFileSync(ONBOARDING_JS, 'utf8');
    if (!onboarding.includes("'assistant'")) {
        onboarding = onboarding.replace(
            "const VALID_TYPES = ['personal-assistant', 'ruthless-mentor', 'executive-assistant', 'generalist']",
            "const VALID_TYPES = ['personal-assistant', 'ruthless-mentor', 'executive-assistant', 'generalist', 'assistant']"
        );
        fs.writeFileSync(ONBOARDING_JS, onboarding);
        console.log('[fix-1] Added assistant to VALID_TYPES');
    }
} catch (e) {
    console.log('[fix-1] Skipping onboardingOneShot.js patch: ' + e.message);
}

if (mount !== original) {
    fs.writeFileSync(MOUNT_JS, mount);
    console.log('[fix-1] Patched enterprise-mount.js — assistant exempt from limits');
} else {
    console.log('[fix-1] enterprise-mount.js already handles assistant role or pattern not found');
}

// ─── 3. Also update the OpenClaw agent config to use chef agentId ───
const OPENCLAW_CONFIG = '/root/.openclaw/openclaw.json';
try {
    const cfg = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8'));
    // Check if there's a ceo agent reference that needs updating
    if (cfg.agents?.defaults?.agentId?.endsWith('-ceo')) {
        cfg.agents.defaults.agentId = cfg.agents.defaults.agentId.replace(/-ceo$/, '-chef');
        fs.writeFileSync(OPENCLAW_CONFIG, JSON.stringify(cfg, null, 2));
        console.log('[fix-1] Updated OpenClaw config agentId → chef');
    }
} catch (e) {
    console.log('[fix-1] OpenClaw config patch skipped: ' + e.message);
}

console.log('[fix-1] Issue 1 complete');
