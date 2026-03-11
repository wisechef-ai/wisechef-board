#!/bin/bash
set -e

echo "🚀 Starting WiseChef container for ${CLIENT_NAME:-Unknown Client}"

# ── Clean Paperclip data on first boot ──
# Docker images baked via `docker commit` include stale DB data from the source container.
# We detect first boot by checking for a sentinel file.
FIRST_BOOT_SENTINEL="/opt/wisechef/.first-boot-done"
if [ ! -f "$FIRST_BOOT_SENTINEL" ]; then
    echo "🧹 First boot — wiping stale Paperclip data for clean start..."
    rm -f /opt/wisechef/data/enterprise.sqlite /opt/wisechef/data/enterprise.sqlite-shm /opt/wisechef/data/enterprise.sqlite-wal 2>/dev/null || true
    rm -rf /root/.paperclip/instances/default/data 2>/dev/null || true
    rm -rf /root/.paperclip/instances/default/workspaces 2>/dev/null || true
    touch "$FIRST_BOOT_SENTINEL"
    echo "✅ Clean Paperclip state ready"
fi

# Initialize OpenClaw config if not exists
if [ ! -f /root/.openclaw/openclaw.json ]; then
    echo "📝 Initializing OpenClaw configuration..."
    mkdir -p /root/.openclaw

    # All plans use the same model
    WISECHEF_MODEL="${WISECHEF_MODEL:-openrouter/anthropic/claude-sonnet-4.6}"
    echo "🤖 Model for ${WISECHEF_PLAN:-starter} plan: $WISECHEF_MODEL"

    # Generate gateway token if not provided
    if [ -z "$GATEWAY_TOKEN" ]; then
        GATEWAY_TOKEN=$(openssl rand -hex 32)
        echo "🔑 Generated gateway token: $GATEWAY_TOKEN"
    fi

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
      "thinkingDefault": "low",
      "heartbeat": {
        "every": "5m",
        "prompt": "Check for pending tasks: curl -sf http://localhost:3333/api/tasks/queue?limit=capacity | Read the JSON. For each task in the queue, pick it up (POST /api/tasks/:id/pickup), work on it, then complete it (POST /api/tasks/:id/complete with {result, status}). If no tasks, reply HEARTBEAT_OK.",
        "target": "none"
      }
    },
    "list": [
      {
        "id": "main",
        "identity": {
          "name": "Chef"
        }
      }
    ]
  }
}
EOF
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

# Create workspace files if they don't exist
if [ ! -f "$WORKSPACE_DIR/SOUL.md" ]; then
    echo "📄 Creating default workspace files..."
    mkdir -p "$WORKSPACE_DIR"

    cat > "$WORKSPACE_DIR/SOUL.md" <<EOF
# SOUL.md — ${CLIENT_NAME:-WiseChef Assistant}

You are Chef, a personal AI assistant powered by WiseChef.

## Identity
- Client: ${CLIENT_NAME:-Not configured}
- Primary channel: ${PRIMARY_CHANNEL:-Not configured}

## Communication Style
- Be helpful, concise, and direct
- Don't use filler phrases ("Great question!", "I'd be happy to help!")
- Just help. Actions over words.
- If you're not sure about something, say so

## Task System
You have a task board. During heartbeats, check for pending tasks:
1. GET http://localhost:3333/api/tasks/queue?limit=capacity
2. For each task: POST http://localhost:3333/api/tasks/:id/pickup
3. Work on the task (whatever the description says)
4. Complete: POST http://localhost:3333/api/tasks/:id/complete with {"result": "summary of what you did"}

## Operating Principles
1. Be proactive — anticipate needs
2. Track commitments — follow up automatically
3. Respect their time — no noise
4. Flag risks early
5. Learn and adapt
6. Own the context
7. Be honest

This file will be customized during onboarding.
EOF

    cat > "$WORKSPACE_DIR/MEMORY.md" <<EOF
# MEMORY.md — ${CLIENT_NAME:-WiseChef Client}

## Profile
- Name: ${CLIENT_NAME:-Not configured}
- Phone: ${CLIENT_PHONE:-Not configured}

## Preferences
(Will be populated during onboarding)
EOF
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

    cd /opt/wisechef/enterprise-panel
    DATABASE_PATH="${DATABASE_PATH:-/opt/wisechef/data/enterprise.sqlite}" \
    PAPERCLIP_AUTH_MODE="${PAPERCLIP_AUTH_MODE:-local_trusted}" \
    PORT="${PAPERCLIP_PORT:-3100}" \
    HOST=127.0.0.1 \
    NODE_ENV=production \
    nohup node server/dist/index.js > /var/log/enterprise-panel.log 2>&1 &
    ENTERPRISE_PID=$!
    echo "Enterprise Panel PID: $ENTERPRISE_PID"

    # Wait for Paperclip to be ready
    echo "⏳ Waiting for Paperclip..."
    for i in $(seq 1 15); do
        if curl -sf http://127.0.0.1:${PAPERCLIP_PORT:-3100}/api/health > /dev/null 2>&1; then
            echo "✅ Paperclip ready"
            break
        fi
        sleep 1
    done

    # === Fix Issue 7: Patch agent gateway URLs after Paperclip is ready ===
    if [ -f /opt/wisechef/manifest.json ]; then
        echo "🔧 Fixing agent gateway URLs..."
        node -e "
        const http = require('http');
        const fs = require('fs');

        const manifest = JSON.parse(fs.readFileSync('/opt/wisechef/manifest.json', 'utf8'));
        const slug = manifest.slug;
        const hostname = manifest.hostname || (slug ? slug + '.wisechef.ai' : null);
        if (!hostname) { console.log('[fix-urls] No hostname or slug in manifest — skipping'); process.exit(0); }
        const gatewayToken = manifest.gatewayToken || '';
        const correctUrl = 'wss://' + hostname + '/gateway';
        const paperclipPort = process.env.PAPERCLIP_PORT || 3100;

        function apiCall(method, apiPath, body) {
            return new Promise((resolve, reject) => {
                const opts = {
                    hostname: '127.0.0.1', port: paperclipPort,
                    path: apiPath, method: method,
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
            const companies = await apiCall('GET', '/api/companies');
            if (!Array.isArray(companies)) { console.log('[fix-urls] No companies yet'); return; }

            let patched = 0;
            for (const company of companies) {
                const agents = await apiCall('GET', '/api/companies/' + company.id + '/agents');
                if (!Array.isArray(agents)) continue;

                for (const agent of agents) {
                    const cfg = agent.adapterConfig || {};
                    if (cfg.url !== correctUrl || cfg.authToken !== gatewayToken) {
                        await apiCall('PATCH', '/api/agents/' + agent.id, {
                            adapterConfig: {
                                ...cfg,
                                url: correctUrl,
                                authToken: gatewayToken,
                                agentId: slug + '-' + (agent.role || 'agent'),
                            }
                        });
                        patched++;
                    }
                }
            }
            console.log('[fix-urls] Patched ' + patched + ' agents → ' + correctUrl);
        }

        fixUrls().then(() => process.exit(0)).catch(e => { console.error('[fix-urls] Error:', e.message); process.exit(1); });
        " 2>&1 || echo "[fix-urls] Script failed (non-fatal)"

        # Bootstrap Paperclip company + Chef agent from manifest
        echo "🏢 Bootstrapping company from manifest..."
        node -e "
        const http = require('http');
        const fs = require('fs');
        const manifest = JSON.parse(fs.readFileSync('/opt/wisechef/manifest.json', 'utf8'));
        const companyName = manifest.name || manifest.slug || 'My Company';
        const slug = manifest.slug || 'default';
        const hostname = manifest.hostname || (slug + '.wisechef.ai');
        const gatewayToken = manifest.gatewayToken || '';
        const correctUrl = 'wss://' + hostname + '/gateway';
        const paperclipPort = process.env.PAPERCLIP_PORT || 3100;

        function apiCall(method, apiPath, body) {
            return new Promise((resolve, reject) => {
                const opts = {
                    hostname: '127.0.0.1', port: paperclipPort,
                    path: apiPath, method,
                    headers: { 'Content-Type': 'application/json' }
                };
                const req = http.request(opts, (res) => {
                    let data = '';
                    res.on('data', d => data += d);
                    res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
                });
                req.on('error', reject);
                if (body) req.write(JSON.stringify(body));
                req.end();
            });
        }

        async function bootstrap() {
            let companies = await apiCall('GET', '/api/companies');
            if (!Array.isArray(companies)) companies = [];

            let company;
            if (companies.length === 0) {
                // Fresh DB — create company
                company = await apiCall('POST', '/api/companies', {
                    name: companyName,
                    description: companyName + ' — powered by WiseChef'
                });
                console.log('[bootstrap] Created company: ' + companyName);
            } else {
                company = companies[0];
                // Rename if still default
                if (company.name === 'Random-cmp') {
                    await apiCall('PATCH', '/api/companies/' + company.id, {
                        name: companyName,
                        description: companyName + ' — powered by WiseChef'
                    });
                    console.log('[bootstrap] Renamed company → ' + companyName);
                } else {
                    console.log('[bootstrap] Company already set: ' + company.name);
                }
            }

            // Check if Chef agent exists
            const agents = await apiCall('GET', '/api/companies/' + company.id + '/agents');
            const hasChef = Array.isArray(agents) && agents.some(a => a.role === 'general' || a.name === 'Chef');
            if (!hasChef) {
                await apiCall('POST', '/api/companies/' + company.id + '/agents', {
                    name: 'Chef',
                    role: 'general',
                    title: 'Personal Assistant',
                    adapterType: 'openclaw_gateway',
                    adapterConfig: {
                        url: correctUrl,
                        authToken: gatewayToken,
                        agentId: slug + '-general'
                    }
                });
                console.log('[bootstrap] Created Chef agent → ' + correctUrl);
            } else {
                console.log('[bootstrap] Chef agent already exists');
            }
        }
        bootstrap().then(() => process.exit(0)).catch(e => { console.error('[bootstrap] Error:', e.message); process.exit(1); });
        " 2>&1 || echo "[bootstrap] Script failed (non-fatal)"
    fi

    cd /opt/wisechef/board
fi

# Start WiseChef Board (foreground)
echo "📊 Starting WiseChef Board on port ${PORT}..."
exec node --env-file=.env server.js
