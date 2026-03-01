#!/bin/bash
# WiseChef Deploy Script v2 — End-to-end VPS provisioning
# Fixes from v1: correct server type, API key injection, doctor --fix, SSH access
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WISECHEF_DIR="$(dirname "$SCRIPT_DIR")"
source /home/adam/clawd/credentials/hetzner.env
source /home/adam/clawd/wisechef/credentials/anthropic.env

CLIENT_ID="${1:?Usage: deploy.sh <client-id>}"
REGISTRY="$WISECHEF_DIR/clients/registry.json"

# Config — ccx13 replaces deprecated cx33
SERVER_TYPE="ccx13"   # 2 dedicated CPU, 8GB RAM
LOCATION="hel1"       # Helsinki
IMAGE="ubuntu-24.04"

echo "🚀 Deploying WiseChef for client: $CLIENT_ID"

# Get client info from registry
CLIENT_NAME=$(jq -r ".clients[] | select(.id==\"$CLIENT_ID\") | .name" "$REGISTRY")
CLIENT_PHONE=$(jq -r ".clients[] | select(.id==\"$CLIENT_ID\") | .phone" "$REGISTRY")
if [ -z "$CLIENT_NAME" ] || [ "$CLIENT_NAME" = "null" ]; then
    echo "❌ Client '$CLIENT_ID' not found in registry"
    exit 1
fi
echo "📋 Client: $CLIENT_NAME ($CLIENT_PHONE)"

# Generate SSH key
SSH_KEY_PATH="$WISECHEF_DIR/clients/$CLIENT_ID/ssh_key"
mkdir -p "$WISECHEF_DIR/clients/$CLIENT_ID"
if [ ! -f "$SSH_KEY_PATH" ]; then
    ssh-keygen -t ed25519 -f "$SSH_KEY_PATH" -N "" -C "wisechef-$CLIENT_ID"
    echo "🔑 SSH key generated"
fi
SSH_PUB=$(cat "${SSH_KEY_PATH}.pub")

# Upload SSH key to Hetzner
echo "☁️ Uploading SSH key..."
SSH_KEY_RESPONSE=$(curl -s -X POST "https://api.hetzner.cloud/v1/ssh_keys" \
    -H "Authorization: Bearer $HETZNER_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"wisechef-$CLIENT_ID\",\"public_key\":\"$SSH_PUB\"}")

SSH_KEY_ID=$(echo "$SSH_KEY_RESPONSE" | jq -r '.ssh_key.id // empty')
if [ -z "$SSH_KEY_ID" ]; then
    if [ "$(echo "$SSH_KEY_RESPONSE" | jq -r '.error.code // empty')" = "uniqueness_error" ]; then
        SSH_KEY_ID=$(curl -s "https://api.hetzner.cloud/v1/ssh_keys" \
            -H "Authorization: Bearer $HETZNER_API_TOKEN" | \
            jq -r ".ssh_keys[] | select(.name==\"wisechef-$CLIENT_ID\") | .id")
        echo "🔑 Using existing SSH key: $SSH_KEY_ID"
    else
        echo "❌ SSH key error: $SSH_KEY_RESPONSE"
        exit 1
    fi
else
    echo "🔑 SSH key uploaded: $SSH_KEY_ID"
fi

# Create server — try locations in order
echo "🖥️ Creating server wisechef-$CLIENT_ID..."
SERVER_IP=""
for LOC in hel1 nbg1 fsn1; do
    echo "   Trying location: $LOC..."
    SERVER_RESPONSE=$(curl -s -X POST "https://api.hetzner.cloud/v1/servers" \
        -H "Authorization: Bearer $HETZNER_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"name\": \"wisechef-$CLIENT_ID\",
            \"server_type\": \"$SERVER_TYPE\",
            \"location\": \"$LOC\",
            \"image\": \"$IMAGE\",
            \"ssh_keys\": [$SSH_KEY_ID],
            \"labels\": {\"project\": \"wisechef\", \"client\": \"$CLIENT_ID\"}
        }")

    SERVER_IP=$(echo "$SERVER_RESPONSE" | jq -r '.server.public_net.ipv4.ip // empty')
    SERVER_HID=$(echo "$SERVER_RESPONSE" | jq -r '.server.id // empty')

    if [ -n "$SERVER_IP" ]; then
        LOCATION="$LOC"
        echo "   ✅ Server created in $LOC: $SERVER_IP (ID: $SERVER_HID)"
        break
    else
        ERROR=$(echo "$SERVER_RESPONSE" | jq -r '.error.message // "unknown"')
        echo "   ⚠️ $LOC failed: $ERROR"
    fi
done

if [ -z "$SERVER_IP" ]; then
    echo "❌ All locations failed. Check Hetzner account limits."
    exit 1
fi

# Update registry
jq ".clients |= map(if .id==\"$CLIENT_ID\" then .vps={\"ip\":\"$SERVER_IP\",\"id\":$SERVER_HID,\"type\":\"$SERVER_TYPE\",\"location\":\"$LOCATION\",\"created\":\"$(date -Iseconds)\"} | .status=\"deployed\" else . end)" \
    "$REGISTRY" > "${REGISTRY}.tmp" && mv "${REGISTRY}.tmp" "$REGISTRY"

# Wait for server boot
echo "⏳ Waiting for server to boot..."
for i in $(seq 1 12); do
    if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -i "$SSH_KEY_PATH" root@"$SERVER_IP" 'echo ok' 2>/dev/null; then
        echo "   Server is ready!"
        break
    fi
    echo "   Waiting... ($i/12)"
    sleep 10
done

# Run remote setup with env vars
echo "🔧 Running remote setup..."
ssh -o StrictHostKeyChecking=no -i "$SSH_KEY_PATH" root@"$SERVER_IP" \
    "export CLIENT_NAME='$CLIENT_NAME' CLIENT_PHONE='$CLIENT_PHONE' ANTHROPIC_API_KEY='$ANTHROPIC_API_KEY'; bash -s" \
    < "$SCRIPT_DIR/setup-remote-v2.sh" 2>&1 | tee "/tmp/wisechef-deploy-$CLIENT_ID.log"

# Extract root password from output
ROOT_PASS=$(grep "^ROOT_PASSWORD:" "/tmp/wisechef-deploy-$CLIENT_ID.log" | cut -d: -f2)

# ============================================================
# DNS + Caddy + Dashboard Onboarding
# ============================================================

# DNS setup (requires HETZNER_DNS_TOKEN)
if [ -f "$WISECHEF_DIR/credentials/hetzner-dns.env" ]; then
    source "$WISECHEF_DIR/credentials/hetzner-dns.env"
    echo "🌐 Setting up DNS..."
    CLIENT_ID="$CLIENT_ID" CLIENT_IP="$SERVER_IP" HETZNER_DNS_TOKEN="$HETZNER_DNS_TOKEN" \
        bash "$SCRIPT_DIR/setup-dns.sh"
fi

# Caddy reverse proxy (TLS + basic auth)
PORTAL_PASS=$(openssl rand -base64 12)
echo "🔒 Setting up Caddy reverse proxy..."
ssh -o StrictHostKeyChecking=no -i "$SSH_KEY_PATH" root@"$SERVER_IP" \
    "export CLIENT_SUBDOMAIN='${CLIENT_ID}.wisechef.ai' CLIENT_USER='$CLIENT_ID' CLIENT_PASS='$PORTAL_PASS'; bash -s" \
    < "$SCRIPT_DIR/setup-caddy.sh" 2>&1 | tee -a "/tmp/wisechef-deploy-$CLIENT_ID.log"

# Upload and patch dashboard with onboarding wizard
echo "🎨 Installing onboarding wizard..."
scp -o StrictHostKeyChecking=no -i "$SSH_KEY_PATH" \
    "$WISECHEF_DIR/dashboard-addon/OnboardingWizard.jsx" \
    "$WISECHEF_DIR/dashboard-addon/onboarding-routes.js" \
    root@"$SERVER_IP":/opt/wisechef/addon/
ssh -o StrictHostKeyChecking=no -i "$SSH_KEY_PATH" root@"$SERVER_IP" 'bash -s' \
    < "$SCRIPT_DIR/patch-dashboard.sh" 2>&1 | tee -a "/tmp/wisechef-deploy-$CLIENT_ID.log"

# Start dashboard
ssh -o StrictHostKeyChecking=no -i "$SSH_KEY_PATH" root@"$SERVER_IP" '
    cd /opt/wisechef/dashboard
    HOST=127.0.0.1 PORT=3333 nohup node server.js > /tmp/dashboard.log 2>&1 &
    echo "Dashboard started on port 3333"
'

# Save deployment info
cat > "$WISECHEF_DIR/clients/$CLIENT_ID/deployment.json" << DEPEOF
{
  "ip": "$SERVER_IP",
  "server_id": $SERVER_HID,
  "server_type": "$SERVER_TYPE",
  "location": "$LOCATION",
  "root_password": "$ROOT_PASS",
  "portal_password": "$PORTAL_PASS",
  "portal_url": "https://${CLIENT_ID}.wisechef.ai",
  "ssh_key": "$SSH_KEY_PATH",
  "deployed_at": "$(date -Iseconds)",
  "model": "anthropic/claude-sonnet-4-6",
  "phone": "$CLIENT_PHONE",
  "status": "deployed_awaiting_onboarding"
}
DEPEOF

echo ""
echo "🎉 WiseChef deployed for $CLIENT_NAME!"
echo "════════════════════════════════════════════"
echo "   IP:       $SERVER_IP"
echo "   Portal:   https://${CLIENT_ID}.wisechef.ai"
echo "   Login:    $CLIENT_ID / $PORTAL_PASS"
echo "   SSH:      ssh -i $SSH_KEY_PATH root@$SERVER_IP"
echo "   SSH Pass: $ROOT_PASS"
echo "   Phone:    $CLIENT_PHONE"
echo "════════════════════════════════════════════"
echo ""
echo "   Client flow:"
echo "   1. Open https://${CLIENT_ID}.wisechef.ai"
echo "   2. Login with credentials above"
echo "   3. Complete onboarding wizard"
echo "   4. Link WhatsApp (scan QR)"
echo "   5. Done! 🎉"
