#!/bin/bash
set -e

echo "🚀 Starting WiseChef container for ${CLIENT_NAME:-Unknown Client}"

# Ensure enough heap for embedded agent fallback
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1024}"

# Initialize OpenClaw config if not exists
if [ ! -f /root/.openclaw/openclaw.json ]; then
    echo "📝 Initializing OpenClaw configuration..."
    mkdir -p /root/.openclaw
    
    # Generate gateway token if not provided
    if [ -z "$GATEWAY_TOKEN" ]; then
        GATEWAY_TOKEN=$(openssl rand -hex 32)
        echo "🔑 Generated gateway token: $GATEWAY_TOKEN"
    fi
    
    # Create openclaw.json — use provider-prefixed model name
    cat > /root/.openclaw/openclaw.json <<EOF
{
  "gateway": {
    "auth": {
      "token": "$GATEWAY_TOKEN"
    },
    "port": 18789,
    "mode": "local"
  },
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-6"
    },
    "list": [
      {
        "id": "main",
        "identity": {
          "name": "Chef"
        }
      }
    ]
  },
  "messages": {
    "responsePrefix": "[Chef]"
  }
}
EOF
    chmod 600 /root/.openclaw/openclaw.json
    chmod 700 /root/.openclaw
fi

# Add primary channel if provided
if [ -n "$PRIMARY_CHANNEL" ] && [ -n "$CLIENT_PHONE" ]; then
    echo "📱 Configuring $PRIMARY_CHANNEL channel..."
    case "$PRIMARY_CHANNEL" in
        whatsapp)
            echo "   WhatsApp requires QR code pairing (manual step)"
            ;;
        telegram)
            if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
                openclaw channels add --channel telegram --token "$TELEGRAM_BOT_TOKEN"
            fi
            ;;
        *)
            echo "   Channel $PRIMARY_CHANNEL not auto-configured"
            ;;
    esac
fi

# Create workspace files if they don't exist
if [ ! -f "$WORKSPACE_DIR/SOUL.md" ]; then
    echo "📄 Creating default workspace files..."
    mkdir -p "$WORKSPACE_DIR"
    
    cat > "$WORKSPACE_DIR/SOUL.md" <<'SOULEOF'
# SOUL.md — WiseChef Assistant

You are a personal AI assistant powered by WiseChef.

## Communication Style
- Be helpful and proactive
- Respect the client's time
- Track commitments and follow up

## Operating Principles
1. Be proactive — anticipate needs
2. Track commitments — follow up automatically
3. Respect their time — no noise
4. Flag risks early
5. Learn and adapt
6. Own the context
7. Be honest

This file will be customized during onboarding.
SOULEOF

    # Patch in client name if available
    if [ -n "$CLIENT_NAME" ]; then
        sed -i "s/WiseChef Assistant/${CLIENT_NAME}/" "$WORKSPACE_DIR/SOUL.md"
    fi

    cat > "$WORKSPACE_DIR/MEMORY.md" <<EOF
# MEMORY.md — ${CLIENT_NAME:-WiseChef Client}

## Profile
- Name: ${CLIENT_NAME:-Not configured}
- Phone: ${CLIENT_PHONE:-Not configured}

## Preferences
(Will be populated during onboarding)
EOF
fi

# Create board .env file
echo "⚙️ Configuring WiseChef Board..."
cd /opt/wisechef/board
cat > .env <<EOF
PORT=${PORT}
GATEWAY_TOKEN=${GATEWAY_TOKEN}
WORKSPACE_DIR=${WORKSPACE_DIR}
HOST=${HOST}
NODE_ENV=production
EOF

# Start signal-cli daemon if Signal is configured (before gateway to avoid race)
SIGNAL_ACCOUNT=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('/root/.openclaw/openclaw.json'));console.log(c.channels?.signal?.account||'')}catch{}" 2>/dev/null)
if [ -n "$SIGNAL_ACCOUNT" ] && command -v signal-cli &>/dev/null; then
    echo "📡 Starting signal-cli daemon for $SIGNAL_ACCOUNT..."
    nohup signal-cli -a "$SIGNAL_ACCOUNT" daemon --http 127.0.0.1:8080 > /var/log/signal-cli.log 2>&1 &
    SIGNAL_PID=$!
    echo "Signal daemon PID: $SIGNAL_PID"
    sleep 3
fi

# Start OpenClaw gateway in background (use nohup in container — no systemd)
echo "🌐 Starting OpenClaw gateway..."
nohup openclaw gateway start > /var/log/openclaw-gateway.log 2>&1 &
GATEWAY_PID=$!
echo "Gateway PID: $GATEWAY_PID"

# Wait for gateway to be ready
sleep 4

# Start WiseChef Board (foreground)
echo "📊 Starting WiseChef Board on port ${PORT}..."
exec node --env-file=.env server.js
