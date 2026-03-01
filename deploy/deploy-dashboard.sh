#!/bin/bash
# Deploy WiseChef Board to a client VPS
# Single service: onboarding + channel linking + full dashboard
# Usage: deploy-dashboard.sh <client-id>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WISECHEF_DIR="$(dirname "$SCRIPT_DIR")"
CLIENT_ID="${1:?Usage: deploy-dashboard.sh <client-id>}"
CLIENT_DIR="$WISECHEF_DIR/clients/$CLIENT_ID"
SSH_KEY="$CLIENT_DIR/ssh_key"

# Get VPS IP from registry
VPS_IP=$(jq -r ".clients[] | select(.id==\"$CLIENT_ID\") | .vps.ip" "$WISECHEF_DIR/clients/registry.json")
[[ -n "$VPS_IP" && "$VPS_IP" != "null" ]] || { echo "❌ No VPS IP for $CLIENT_ID"; exit 1; }

echo "📦 Deploying WiseChef Board to $CLIENT_ID ($VPS_IP)"

ssh -o StrictHostKeyChecking=no -i "$SSH_KEY" "root@$VPS_IP" bash <<'REMOTE'
set -euo pipefail

# Stop old dashboard service if it exists
systemctl stop wisechef-dashboard 2>/dev/null || true
systemctl disable wisechef-dashboard 2>/dev/null || true
rm -f /etc/systemd/system/wisechef-dashboard.service

if [ -d /opt/wisechef/board/.git ]; then
    echo "   Board exists, pulling updates..."
    cd /opt/wisechef/board
    git pull origin main 2>&1 | tail -2
else
    echo "   Cloning board..."
    cd /opt/wisechef
    git clone https://github.com/wisechef-ai/wisechef-board.git board 2>&1 | tail -2
    cd board
fi

cd /opt/wisechef/board
npm install --production=false 2>&1 | tail -3
npx vite build 2>&1 | tail -3

# Create/update .env
GATEWAY_TOKEN=$(python3 -c "import json; print(json.load(open('/root/.openclaw/openclaw.json')).get('gateway',{}).get('auth',{}).get('token',''))" 2>/dev/null || echo "")
cat > .env << ENVEOF
PORT=3333
GATEWAY_TOKEN=${GATEWAY_TOKEN}
WORKSPACE_DIR=/opt/wisechef/clawd
HOST=127.0.0.1
ENVEOF

cat > /etc/systemd/system/wisechef-board.service << 'SVC'
[Unit]
Description=WiseChef Board
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/wisechef/board
ExecStart=/usr/bin/node --env-file=.env server.js
Restart=on-failure
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SVC

systemctl daemon-reload
systemctl enable wisechef-board
systemctl restart wisechef-board
sleep 2
echo "   Board: $(systemctl is-active wisechef-board)"
REMOTE

echo "✅ WiseChef Board deployed for $CLIENT_ID"
echo "   URL: https://$CLIENT_ID.wisechef.ai"
