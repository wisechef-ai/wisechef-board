#!/bin/bash
# post-install.sh — WiseChef Agent Post-Install Script
# Pulled at spawn time, runs inside container after first boot.
# This is the SINGLE place for all runtime tool installations.
# CalVer: 2026.04.1
#
# Usage: curl -sf https://raw.githubusercontent.com/wisechef-ai/wisechef-board/release/v26.04.1/docker/post-install.sh | bash
# Or: /opt/wisechef/board/docker/post-install.sh

set -e

MARKER="/opt/wisechef/.post-install-done"
VERSION="2026.04.1a"
LOG="/opt/wisechef/logs/post-install.log"
mkdir -p /opt/wisechef/logs

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

# Skip if already done for this version
if [ -f "$MARKER" ] && grep -q "$VERSION" "$MARKER" 2>/dev/null; then
    log "Post-install v$VERSION already completed, skipping."
    exit 0
fi

log "=== WiseChef Post-Install v$VERSION starting ==="

# ── 1. Python venv (shared for all Python tools) ──
VENV="/opt/wisechef/venv"
if [ ! -d "$VENV" ]; then
    log "Creating Python venv..."
    python3 -m venv "$VENV"
fi
source "$VENV/bin/activate"

# ── 2. Cognee (Knowledge Graph) ──
log "Installing Cognee..."
pip install --quiet cognee==0.5.5 2>>"$LOG" || {
    log "⚠️ Cognee install failed (non-fatal, will retry next boot)"
}

# Configure Cognee with OpenRouter-compatible endpoint
COGNEE_CFG="/opt/wisechef/cognee"
mkdir -p "$COGNEE_CFG"
if [ -n "$OPENROUTER_API_KEY" ]; then
    cat > "$COGNEE_CFG/.env" <<CEOF
# Cognee config — uses OpenRouter for LLM + embeddings
OPENAI_API_KEY=$OPENROUTER_API_KEY
OPENAI_API_BASE=https://openrouter.ai/api/v1
LLM_MODEL=openai/gpt-4o
EMBEDDING_MODEL=openai/text-embedding-3-small
COGNEE_HOME=$COGNEE_CFG
CEOF
    log "✅ Cognee configured with OpenRouter (gpt-4o)"
else
    log "⚠️ No OPENROUTER_API_KEY — Cognee will need manual config"
fi

# ── 3. Scrapling (Web Scraper) ──
log "Installing Scrapling..."
pip install --quiet scrapling 2>>"$LOG" && {
    # Install browser dependencies
    "$VENV/bin/scrapling" install 2>>"$LOG" || log "⚠️ Scrapling browser setup failed (can retry later)"
    log "✅ Scrapling installed"
} || {
    log "⚠️ Scrapling install failed (non-fatal)"
}

# ── 4. PinchTab (Browser Control for Agents) ──
log "Installing PinchTab..."
npm install -g pinchtab@latest 2>>"$LOG" && {
    log "✅ PinchTab installed"
} || {
    log "⚠️ PinchTab install failed (non-fatal)"
}

# ── 5. Cognee CLI wrapper ──
cat > /usr/local/bin/cognee-query <<'QEOF'
#!/bin/bash
# cognee-query — simple CLI for Cognee knowledge graph
source /opt/wisechef/venv/bin/activate
export COGNEE_HOME=/opt/wisechef/cognee
source /opt/wisechef/cognee/.env 2>/dev/null

case "${1:-search}" in
    add)
        shift
        python3 -c "
import asyncio, cognee
async def main():
    await cognee.add('$*')
    await cognee.cognify()
    print('Added and cognified.')
asyncio.run(main())
"
        ;;
    search|*)
        query="${1:-help}"
        [ "$1" = "search" ] && shift && query="$*"
        python3 -c "
import asyncio, cognee
async def main():
    results = await cognee.search('GRAPH_COMPLETION', query='$query')
    for r in results:
        print(r)
asyncio.run(main())
"
        ;;
esac
QEOF
chmod +x /usr/local/bin/cognee-query

# ── 6. Fix pairing code leak ──
# The gateway was replying with pairing codes in channel messages
# when mode was not correctly set. Fix: ensure gateway config has
# proper device pairing settings
OPENCLAW_CFG="/root/.openclaw/openclaw.json"
if [ -f "$OPENCLAW_CFG" ]; then
    # Use node to patch the config safely
    node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('$OPENCLAW_CFG', 'utf8'));

// Remove deprecated keys that break new OpenClaw (strict validation)
if (!cfg.gateway) cfg.gateway = {};
for (const key of ['devicePairing', 'dangerouslyDisableDeviceAuth', 'apiTokens']) {
    delete cfg.gateway[key];
}
// Disable device-pair plugin (prevents pairing code leak)
if (!cfg.plugins) cfg.plugins = {};
if (!cfg.plugins.entries) cfg.plugins.entries = {};
cfg.plugins.entries['device-pair'] = { enabled: false };
// Bind to all interfaces for Docker
cfg.gateway.bind = 'lan';
// Ensure env has API key for model resolution
if (!cfg.env) cfg.env = {};
if (process.env.OPENROUTER_API_KEY && !cfg.env.OPENROUTER_API_KEY) {
    cfg.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
}
fs.writeFileSync('$OPENCLAW_CFG', JSON.stringify(cfg, null, 2));
console.log('[sanitize] Config patched: deprecated keys removed, device-pair disabled');
" 2>>"$LOG" || log "⚠️ Config patch failed"
fi

# ── 7. Mark complete ──
echo "$VERSION $(date -Iseconds)" > "$MARKER"
log "=== WiseChef Post-Install v$VERSION complete ==="
