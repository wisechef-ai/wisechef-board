#!/bin/bash
# WiseChef Tunnel Setup — Creates Cloudflare Tunnel for a client VPS
# Runs LOCALLY. Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLIENT_ID, CLIENT_IP, SSH_KEY
set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?Required: CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?Required: CLOUDFLARE_ACCOUNT_ID}"
: "${CLIENT_ID:?Required: CLIENT_ID}"
: "${CLIENT_IP:?Required: CLIENT_IP}"
: "${SSH_KEY:?Required: SSH_KEY (path to SSH private key)}"

DOMAIN="wisechef.ai"
CF_API="https://api.cloudflare.com/client/v4"
AUTH="Authorization: Bearer $CLOUDFLARE_API_TOKEN"

echo "🚇 Setting up Cloudflare Tunnel for ${CLIENT_ID}"

# 1. Create tunnel
echo "   Creating tunnel wisechef-${CLIENT_ID}..."
TUNNEL_SECRET=$(openssl rand -base64 32)
TUNNEL_RESPONSE=$(curl -s -X POST "${CF_API}/accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d "{\"name\":\"wisechef-${CLIENT_ID}\",\"tunnel_secret\":\"${TUNNEL_SECRET}\"}")

TUNNEL_ID=$(echo "$TUNNEL_RESPONSE" | jq -r '.result.id')
TUNNEL_TOKEN=$(echo "$TUNNEL_RESPONSE" | jq -r '.result.token')

if [ -z "$TUNNEL_ID" ] || [ "$TUNNEL_ID" = "null" ]; then
    echo "   ❌ Failed to create tunnel"
    echo "$TUNNEL_RESPONSE" | jq .
    exit 1
fi
echo "   ✅ Tunnel created: $TUNNEL_ID"

# 2. Configure tunnel routing
echo "   Configuring tunnel routing..."
curl -s -X PUT "${CF_API}/accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/configurations" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d "{
        \"config\": {
            \"ingress\": [
                {\"hostname\": \"${CLIENT_ID}.${DOMAIN}\", \"service\": \"http://localhost:3000\"},
                {\"service\": \"http_status:404\"}
            ]
        }
    }" | jq -r '.success' | grep -q true && echo "   ✅ Routing configured" || { echo "   ❌ Routing failed"; exit 1; }

# 3. Install cloudflared on VPS
echo "   Installing cloudflared on ${CLIENT_IP}..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "root@${CLIENT_IP}" bash << REMOTE
set -e

# Install cloudflared if not present
if ! command -v cloudflared &>/dev/null; then
    echo "   Installing cloudflared..."
    curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
    dpkg -i /tmp/cloudflared.deb
    rm /tmp/cloudflared.deb
fi

echo "   cloudflared \$(cloudflared --version)"

# Remove existing service if present (idempotent)
cloudflared service uninstall 2>/dev/null || true

# Install as service with tunnel token
cloudflared service install ${TUNNEL_TOKEN}
systemctl enable cloudflared
systemctl start cloudflared

# Wait and verify
sleep 3
if systemctl is-active cloudflared >/dev/null 2>&1; then
    echo "   ✅ cloudflared service running"
else
    echo "   ❌ cloudflared service failed"
    systemctl status cloudflared --no-pager
    exit 1
fi
REMOTE

# 4. Save tunnel info
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIR="${SCRIPT_DIR}/../clients/${CLIENT_ID}"
mkdir -p "$CLIENT_DIR"
cat > "${CLIENT_DIR}/tunnel.json" << EOF
{
    "tunnel_id": "${TUNNEL_ID}",
    "tunnel_name": "wisechef-${CLIENT_ID}",
    "hostname": "${CLIENT_ID}.${DOMAIN}",
    "cname_target": "${TUNNEL_ID}.cfargotunnel.com",
    "created": "$(date -Iseconds)"
}
EOF
echo "   ✅ Tunnel info saved to ${CLIENT_DIR}/tunnel.json"

# 5. DNS reminder
echo ""
echo "   📋 DNS: Add CNAME record in Hetzner DNS:"
echo "   ${CLIENT_ID}.${DOMAIN} → ${TUNNEL_ID}.cfargotunnel.com"
echo ""
echo "   🎉 Tunnel setup complete for ${CLIENT_ID}!"
