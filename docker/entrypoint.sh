#!/bin/bash
set -e

echo "🚀 Starting WiseChef container for ${CLIENT_NAME:-Unknown Client}"

# ── Clean Paperclip data on first boot ──
# Docker images baked via `docker commit` include stale DB data from the source container.
# We detect first boot by checking for a sentinel file.
FIRST_BOOT_SENTINEL="/opt/wisechef/.first-boot-done"
if [ ! -f "$FIRST_BOOT_SENTINEL" ]; then
    echo "🧹 First boot — wiping stale data for clean start..."
    rm -f /opt/wisechef/data/enterprise.sqlite /opt/wisechef/data/enterprise.sqlite-shm /opt/wisechef/data/enterprise.sqlite-wal 2>/dev/null || true
    rm -rf /root/.paperclip/instances/default/data 2>/dev/null || true
    rm -rf /root/.paperclip/instances/default/workspaces 2>/dev/null || true
    # Clean OpenClaw session history (baked from source container)
    rm -rf /root/.openclaw/agents/*/sessions 2>/dev/null || true
    rm -f /root/.openclaw/devices/paired.json 2>/dev/null || true
    rm -f /root/.openclaw/devices/pending.json 2>/dev/null || true
    rm -f /root/.openclaw/credentials/signal-pairing.json 2>/dev/null || true
    rm -f /root/.openclaw/cron/jobs.json 2>/dev/null || true
    # Remove stale Paperclip API key (will be re-claimed after Paperclip starts)
    rm -f /opt/wisechef/workspace/paperclip-claimed-api-key.json 2>/dev/null || true
    rm -f /root/.openclaw/workspace/paperclip-claimed-api-key.json 2>/dev/null || true
    # Remove stale OpenClaw config so it gets recreated with correct gateway token
    rm -f /root/.openclaw/openclaw.json 2>/dev/null || true
    rm -f /root/.openclaw/provider-keys.json 2>/dev/null || true
    touch "$FIRST_BOOT_SENTINEL"
    echo "✅ Clean state ready"
fi

# Initialize OpenClaw config if not exists
if [ ! -f /root/.openclaw/openclaw.json ]; then
    echo "📝 Initializing OpenClaw configuration..."
    mkdir -p /root/.openclaw

    # Resolve model from tier config
    WISECHEF_MODEL="${WISECHEF_MODEL:-$(node -e "
      import { resolveTier } from '/opt/wisechef/board/docker/tier-config.js';
      const t = resolveTier(process.env.WISECHEF_PLAN);
      process.stdout.write(t.model);
    " 2>/dev/null || echo 'openrouter/google/gemini-2.5-flash')}"
    echo "🤖 Model for ${WISECHEF_PLAN:-contractor} plan: $WISECHEF_MODEL"

    # Generate gateway token if not provided
    if [ -z "$GATEWAY_TOKEN" ]; then
        GATEWAY_TOKEN=$(openssl rand -hex 32)
        echo "🔑 Generated gateway token: $GATEWAY_TOKEN"
    fi

    # Resolve heartbeat interval from tier config
    HEARTBEAT_INTERVAL="${WISECHEF_HEARTBEAT:-$(node -e "
      import { resolveTier } from '/opt/wisechef/board/docker/tier-config.js';
      process.stdout.write(resolveTier(process.env.WISECHEF_PLAN).heartbeatInterval);
    " 2>/dev/null || echo '10m')}"

    # Resolve thinking default from tier config
    THINKING_DEFAULT="$(node -e "
      import { resolveTier } from '/opt/wisechef/board/docker/tier-config.js';
      process.stdout.write(resolveTier(process.env.WISECHEF_PLAN).thinkingDefault);
    " 2>/dev/null || echo 'off')"

    cat > /root/.openclaw/openclaw.json <<EOF
{
  "gateway": {
    "auth": {
      "token": "$GATEWAY_TOKEN"
    },
    "port": 18789,
    "mode": "local",
    "http": {
      "endpoints": {
        "chatCompletions": { "enabled": true }
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "$WISECHEF_MODEL"
      },
      "thinkingDefault": "$THINKING_DEFAULT",
      "heartbeat": {
        "every": "$HEARTBEAT_INTERVAL",
        "prompt": "Check for pending tasks: curl -sf http://localhost:3333/api/tasks/queue?limit=capacity | Read the JSON. For each task in the queue, pick it up (POST /api/tasks/:id/pickup), work on it, then complete it (POST /api/tasks/:id/complete with {result, status}). If no tasks, reply HEARTBEAT_OK.",
        "target": "none"
      }
    },
    "list": [
      {
        "id": "main",
        "workspace": "$WORKSPACE_DIR",
        "identity": {
          "name": "Chef"
        }
      }
    ]
  },
  "env": {}
}
EOF

    # Inject API keys into openclaw.json env section (avoids trailing-comma JSON issues)
    node -e "
      const fs = require('fs');
      const cfg = JSON.parse(fs.readFileSync('/root/.openclaw/openclaw.json','utf8'));
      cfg.env = cfg.env || {};
      const keys = {
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        WISECHEF_PLAN: process.env.WISECHEF_PLAN || '',
      };
      for (const [k,v] of Object.entries(keys)) { if (v) cfg.env[k] = v; }
      fs.writeFileSync('/root/.openclaw/openclaw.json', JSON.stringify(cfg, null, 2));
      console.log('[entrypoint] Injected env keys:', Object.keys(cfg.env).join(', '));
    "
    chmod 600 /root/.openclaw/openclaw.json
    chmod 700 /root/.openclaw
fi

# Write OpenRouter API key to provider-keys.json if provided
if [ -n "$OPENROUTER_API_KEY" ] && [ ! -f /root/.openclaw/provider-keys.json ]; then
    echo "🔑 Writing OpenRouter API key to provider-keys.json..."
    cat > /root/.openclaw/provider-keys.json <<PKEOF
{
  "openrouter": {
    "apiKey": "$OPENROUTER_API_KEY"
  }
}
PKEOF
    chmod 600 /root/.openclaw/provider-keys.json
fi

# Create workspace files if they don't exist (tier-aware SOUL.md)
if [ ! -f "$WORKSPACE_DIR/SOUL.md" ]; then
    echo "📄 Creating tier-specific workspace files..."
    mkdir -p "$WORKSPACE_DIR"

    # Generate SOUL.md from tier template
    node -e "
      import { resolveTier, getSoulTemplate } from '/opt/wisechef/board/docker/tier-config.js';
      import fs from 'fs';
      const tier = resolveTier(process.env.WISECHEF_PLAN);
      const soul = getSoulTemplate(
        tier.soulTemplate,
        process.env.CLIENT_NAME || 'WiseChef Client',
        process.env.CLIENT_ORG || process.env.CLIENT_NAME || '',
        process.env.CLIENT_USE_CASE || '',
        process.env.CLIENT_CHANNEL || process.env.PRIMARY_CHANNEL || ''
      );
      fs.writeFileSync(process.env.WORKSPACE_DIR + '/SOUL.md', soul);
      console.log('[entrypoint] Created ' + tier.key + ' SOUL.md for ' + (process.env.CLIENT_NAME || 'client'));
    " 2>&1 || {
        # Fallback: write a basic SOUL.md if tier-config fails
        cat > "$WORKSPACE_DIR/SOUL.md" <<EOF
# Chef — Your AI Assistant

You are Chef, a personal AI assistant for ${CLIENT_NAME:-your client}.

## Task System
Check for tasks: curl -sf http://localhost:3333/api/tasks/queue?limit=1
Pick up: POST /api/tasks/:id/pickup
Complete: POST /api/tasks/:id/complete with {"result": "summary"}

## Communication
- Be helpful, concise, and direct
- Just help. Actions over words.
EOF
        echo "[entrypoint] Created fallback SOUL.md"
    }

    cat > "$WORKSPACE_DIR/MEMORY.md" <<EOF
# MEMORY.md — ${CLIENT_NAME:-WiseChef Client}

## Profile
- Name: ${CLIENT_NAME:-Not configured}
- Phone: ${CLIENT_PHONE:-Not configured}
- Plan: ${WISECHEF_PLAN:-contractor}

## Preferences
(Will be populated during onboarding)
EOF

    # Write tier manifest to workspace for agent self-awareness
    node -e "
      import { resolveTier } from '/opt/wisechef/board/docker/tier-config.js';
      import fs from 'fs';
      const tier = resolveTier(process.env.WISECHEF_PLAN);
      fs.writeFileSync(process.env.WORKSPACE_DIR + '/TIER.json', JSON.stringify({
        plan: tier.key,
        label: tier.label,
        model: tier.model,
        totalAgentsCap: tier.totalAgentsCap,
        heartbeatInterval: tier.heartbeatInterval,
        features: tier.features,
      }, null, 2));
    " 2>&1 || echo "[entrypoint] TIER.json write skipped"
fi

# Create project workspace directory (Issue 6)
mkdir -p /opt/wisechef/workspace/projects

# Create board .env file
echo "⚙️ Configuring WiseChef Board..."
cd /opt/wisechef/board
cat > .env <<EOF
PORT=${PORT}
GATEWAY_TOKEN=${GATEWAY_TOKEN}
WORKSPACE_DIR=${WORKSPACE_DIR}
HOST=${HOST}
NODE_ENV=production
AGENT_TYPES_ENABLED=false
EOF

# Start OpenClaw gateway in background
echo "🌐 Starting OpenClaw gateway..."
# Kill any stale gateway on the port first (prevents "port already in use" on container restart)
fuser -k 18789/tcp 2>/dev/null || true
sleep 1
nohup openclaw gateway run > /var/log/openclaw-gateway.log 2>&1 &
GATEWAY_PID=$!
echo "Gateway PID: $GATEWAY_PID"

# Wait for gateway to be ready
sleep 4

# Sync provider API keys from provider-keys.json → env vars
if [ -f /root/.openclaw/provider-keys.json ]; then
    echo "🔑 Loading provider API keys..."
    eval $(node -e "
    try {
      const k = JSON.parse(require('fs').readFileSync('/root/.openclaw/provider-keys.json','utf8'));
      const m = {anthropic:'ANTHROPIC_API_KEY',google:'GEMINI_API_KEY',openai:'OPENAI_API_KEY',openrouter:'OPENROUTER_API_KEY'};
      for (const [p,d] of Object.entries(k)) { if (m[p] && d.apiKey) console.log('export '+m[p]+'='+JSON.stringify(d.apiKey)); }
    } catch {}
  ")
fi

# Migrate legacy config.providers on startup (if present)
node -e "
  const fs = require('fs');
  const cfgPath = '/root/.openclaw/openclaw.json';
  const keysPath = '/root/.openclaw/provider-keys.json';
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath,'utf8'));
    if (cfg.providers && Object.keys(cfg.providers).length) {
      let keys = {};
      try { keys = JSON.parse(fs.readFileSync(keysPath,'utf8')); } catch {}
      for (const [p,d] of Object.entries(cfg.providers)) {
        if (d.apiKey && !keys[p]?.apiKey) keys[p] = {apiKey:d.apiKey};
      }
      fs.writeFileSync(keysPath, JSON.stringify(keys,null,2), {mode:0o600});
      delete cfg.providers;
      fs.writeFileSync(cfgPath, JSON.stringify(cfg,null,2));
      console.log('[entrypoint] Migrated legacy config.providers');
    }
  } catch {}
" 2>/dev/null || true

# === Start Enterprise Panel (Paperclip native) ===
if [ -d /opt/wisechef/enterprise-panel/server/dist ]; then
    echo "📊 Starting Enterprise Panel (Paperclip on port ${PAPERCLIP_PORT:-3100})..."
    mkdir -p /opt/wisechef/data

    # Patch embedded-postgres to work as root (add createPostgresUser: true)
    EPANEL_INDEX="/opt/wisechef/enterprise-panel/server/dist/index.js"
    if grep -q 'new EmbeddedPostgres({' "$EPANEL_INDEX" && ! grep -q 'createPostgresUser' "$EPANEL_INDEX"; then
        echo "[patch] Adding createPostgresUser:true to embedded-postgres config..."
        sed -i 's/new EmbeddedPostgres({/new EmbeddedPostgres({ createPostgresUser: true,/' "$EPANEL_INDEX"
    fi

    # Patch embedded-postgres locale: en_US.UTF-8 doesn't exist in minimal Docker images
    EP_LIB="/opt/wisechef/enterprise-panel/node_modules/.pnpm/embedded-postgres@18.1.0-beta.16/node_modules/embedded-postgres/dist/index.js"
    if [ -f "$EP_LIB" ] && grep -q "en_US.UTF-8" "$EP_LIB"; then
        echo "[patch] Fixing embedded-postgres locale (en_US.UTF-8 → C)..."
        sed -i "s/const LC_MESSAGES_LOCALE = .*/const LC_MESSAGES_LOCALE = 'C';/" "$EP_LIB"
    fi

    # Pre-create postgres user/group if running as root (avoids embedded-postgres race)
    if [ "$(id -u)" = "0" ] && ! id postgres >/dev/null 2>&1; then
        echo "[patch] Pre-creating postgres user for embedded-postgres..."
        groupadd -f postgres 2>/dev/null || true
        useradd -g postgres -s /bin/false -M postgres 2>/dev/null || true
    fi

    # Ensure /root is traversable by postgres user (initdb runs as postgres via spawn uid/gid)
    if [ "$(id -u)" = "0" ]; then
        chmod 755 /root
    fi

    cd /opt/wisechef/enterprise-panel
    DATABASE_PATH="${DATABASE_PATH:-/opt/wisechef/data/enterprise.sqlite}" \
    PAPERCLIP_AUTH_MODE="${PAPERCLIP_AUTH_MODE:-local_trusted}" \
    PORT="${PAPERCLIP_PORT:-3100}" \
    HOST=127.0.0.1 \
    NODE_ENV=production \
    nohup node --import ./server/node_modules/tsx/dist/loader.mjs server/dist/index.js > /var/log/enterprise-panel.log 2>&1 &
    ENTERPRISE_PID=$!
    echo "Enterprise Panel PID: $ENTERPRISE_PID"

    # Wait for Paperclip to be ready
    echo "⏳ Waiting for Paperclip..."
    PAPERCLIP_READY=false
    for i in $(seq 1 20); do
        if curl -sf http://127.0.0.1:${PAPERCLIP_PORT:-3100}/api/health > /dev/null 2>&1; then
            echo "✅ Paperclip ready"
            PAPERCLIP_READY=true
            break
        fi
        sleep 1
    done

    # Auto-generate manifest.json from env vars if missing
    if [ ! -f /opt/wisechef/manifest.json ] && [ -n "$CLIENT_NAME" ]; then
        echo "📋 Generating manifest.json from env vars..."
        cat > /opt/wisechef/manifest.json <<MANEOF
{
  "name": "${CLIENT_NAME}",
  "slug": "$(echo "${CLIENT_NAME}" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-')",
  "gatewayToken": "${GATEWAY_TOKEN}",
  "plan": "${WISECHEF_PLAN:-contractor}",
  "phone": "${CLIENT_PHONE:-}",
  "channel": "${CLIENT_CHANNEL:-}"
}
MANEOF
    fi

    # === Bootstrap + per-company agent isolation ===
    if [ "$PAPERCLIP_READY" = true ] && [ -f /opt/wisechef/manifest.json ]; then
        # Bootstrap Paperclip company + Chef agent from manifest
        echo "🏢 Bootstrapping company from manifest..."
        node -e "
        const http = require('http');
        const fs = require('fs');
        const manifest = JSON.parse(fs.readFileSync('/opt/wisechef/manifest.json', 'utf8'));
        const companyName = manifest.name || manifest.slug || 'My Company';
        const gatewayToken = manifest.gatewayToken || '';
        const correctUrl = 'ws://localhost:18789/gateway';
        const paperclipPort = process.env.PAPERCLIP_PORT || 3100;

        function apiCall(method, apiPath, body) {
            return new Promise((resolve, reject) => {
                const opts = { hostname: '127.0.0.1', port: paperclipPort, path: apiPath, method, headers: { 'Content-Type': 'application/json' } };
                const req = http.request(opts, (res) => { let data = ''; res.on('data', d => data += d); res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } }); });
                req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
            });
        }

        async function bootstrap() {
            let companies = await apiCall('GET', '/api/companies');
            if (!Array.isArray(companies)) companies = [];
            let company;
            if (companies.length === 0) {
                company = await apiCall('POST', '/api/companies', { name: companyName, description: companyName + ' — powered by WiseChef' });
                console.log('[bootstrap] Created company: ' + companyName);
            } else {
                company = companies[0];
                if (company.name === 'Random-cmp') {
                    await apiCall('PATCH', '/api/companies/' + company.id, { name: companyName, description: companyName + ' — powered by WiseChef' });
                    console.log('[bootstrap] Renamed company → ' + companyName);
                } else {
                    console.log('[bootstrap] Company already set: ' + company.name);
                }
            }
            const agents = await apiCall('GET', '/api/companies/' + company.id + '/agents');
            const hasChef = Array.isArray(agents) && agents.some(a => a.role === 'general' || a.name === 'Chef');
            if (!hasChef) {
                // Initial agent gets company-specific agentId (sync-agents will confirm)
                await apiCall('POST', '/api/companies/' + company.id + '/agents', {
                    name: 'Chef', role: 'general', title: 'Personal Assistant',
                    adapterType: 'openclaw_gateway',
                    adapterConfig: { url: correctUrl, authToken: gatewayToken, agentId: 'company-' + company.id }
                });
                console.log('[bootstrap] Created Chef agent → company-' + company.id);
            } else { console.log('[bootstrap] Chef agent already exists'); }
        }
        bootstrap().then(() => process.exit(0)).catch(e => { console.error('[bootstrap]', e.message); process.exit(1); });
        " 2>&1 || echo "[bootstrap] Script failed (non-fatal)"

        # Set initial heartbeat so agents show as "idle" (not "not deployed")
        if [ -n "${DATABASE_URL:-}" ]; then
            echo "💓 Skipping SQLite heartbeat init (external database in use)"
        else
            echo "💓 Setting initial agent heartbeat..."
            node -e "
            const path = require('path');
            const Database = require(path.join('/opt/wisechef/enterprise-panel/node_modules/better-sqlite3'));
            const db = new Database('/opt/wisechef/data/enterprise.sqlite');
            const now = new Date().toISOString();
            const result = db.prepare('UPDATE agents SET last_heartbeat_at = ?, status = ? WHERE last_heartbeat_at IS NULL').run(now, 'idle');
            if (result.changes > 0) console.log('[heartbeat] Initialized ' + result.changes + ' agents');
            else console.log('[heartbeat] All agents already have heartbeat');
            db.close();
            " 2>&1 || echo "[heartbeat] Script failed (non-fatal)"
        fi

        # Sync Paperclip companies → OpenClaw agents (per-company isolation)
        # Creates per-company OpenClaw agents, workspaces, fixes agentIds, claims API keys
        echo "🔄 Syncing per-company OpenClaw agents..."
        node /opt/wisechef/board/docker/sync-agents.js 2>&1 || echo "[sync-agents] Script failed (non-fatal)"

        # Restart gateway to pick up new agents
        echo "🔄 Restarting OpenClaw gateway with updated agents..."
        fuser -k 18789/tcp 2>/dev/null || true
        sleep 2
        nohup openclaw gateway run > /var/log/openclaw-gateway.log 2>&1 &
        echo "Gateway restarted (PID: $!)"
        # Wait for gateway to be healthy (up to 15s)
        GATEWAY_READY=false
        for i in $(seq 1 15); do
            if curl -sf http://127.0.0.1:18789/health > /dev/null 2>&1; then
                echo "✅ Gateway ready after ${i}s"
                GATEWAY_READY=true
                break
            fi
            sleep 1
        done
        if [ "$GATEWAY_READY" != "true" ]; then
            echo "⚠️ Gateway not responding after 15s — check /var/log/openclaw-gateway.log"
        fi

        # Verify agents are registered
        node -e "
          const cfg = JSON.parse(require('fs').readFileSync('/root/.openclaw/openclaw.json','utf8'));
          const agents = cfg.agents?.list || [];
          console.log('[verify] ' + agents.length + ' agents in config:');
          agents.forEach(a => console.log('  → ' + a.id + (a.identity?.name ? ' (' + a.identity.name + ')' : '')));
        " 2>&1 || true
    fi

    cd /opt/wisechef/board
fi

# Install/start nightly self-improvement cron (pro/enterprise only)
SELF_IMPROVE_ENABLED="${WISECHEF_SELF_IMPROVE_ENABLED:-$(node -e "
  import { resolveTier } from '/opt/wisechef/board/docker/tier-config.js';
  process.stdout.write(String(resolveTier(process.env.WISECHEF_PLAN).features.selfImprove));
" 2>/dev/null || echo 'false')}"
if [ "$SELF_IMPROVE_ENABLED" = "true" ]; then
    echo "🧠 Enabling nightly self-improvement cron..."
    mkdir -p /etc/cron.d /var/log /opt/wisechef/logs/self-improve
    # Write secrets to a root-only env file (avoid leaking them via /etc/cron.d)
    cat > /opt/wisechef/runtime.env <<ENV
OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
WORKSPACE_DIR=${WORKSPACE_DIR}
BOARD_URL=http://127.0.0.1:${PORT}
COGNEE_HOME=${COGNEE_HOME:-/opt/wisechef/cognee}
ENV
    chmod 600 /opt/wisechef/runtime.env

    cat > /etc/cron.d/wisechef-nightly <<CRON
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
${WISECHEF_SELF_IMPROVE_CRON:-17 2 * * *} root bash -lc 'set -a; source /opt/wisechef/runtime.env; set +a; /opt/wisechef/board/docker/nightly-self-improve.sh'
CRON
    chmod 0644 /etc/cron.d/wisechef-nightly
    touch /var/log/cron.log
    cron
fi

# Start WiseChef Board (foreground)
echo "📊 Starting WiseChef Board on port ${PORT}..."
exec node --env-file=.env server.js
