#!/bin/bash
# WiseChef Deploy Script — Provisions a Hetzner VPS for a client
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WISECHEF_DIR="$(dirname "$SCRIPT_DIR")"
source /home/adam/clawd/credentials/hetzner.env

CLIENT_ID="${1:?Usage: deploy.sh <client-id>}"
REGISTRY="$WISECHEF_DIR/clients/registry.json"

# Config
SERVER_TYPE="cx33"  # 4 CPU, 8GB RAM — €5.99/mo
LOCATION="hel1"     # Helsinki, Finland
IMAGE="ubuntu-24.04"

echo "🚀 Deploying WiseChef for client: $CLIENT_ID"

# Get client name from registry
CLIENT_NAME=$(jq -r ".clients[] | select(.id==\"$CLIENT_ID\") | .name" "$REGISTRY")
if [ -z "$CLIENT_NAME" ] || [ "$CLIENT_NAME" = "null" ]; then
    echo "❌ Client '$CLIENT_ID' not found in registry"
    exit 1
fi
echo "📋 Client: $CLIENT_NAME"

# Generate SSH key for this client
SSH_KEY_PATH="$WISECHEF_DIR/clients/$CLIENT_ID/ssh_key"
mkdir -p "$WISECHEF_DIR/clients/$CLIENT_ID"
if [ ! -f "$SSH_KEY_PATH" ]; then
    ssh-keygen -t ed25519 -f "$SSH_KEY_PATH" -N "" -C "wisechef-$CLIENT_ID"
    echo "🔑 SSH key generated"
fi
SSH_PUB=$(cat "${SSH_KEY_PATH}.pub")

# Upload SSH key to Hetzner
echo "☁️ Uploading SSH key to Hetzner..."
SSH_KEY_RESPONSE=$(curl -s -X POST "https://api.hetzner.cloud/v1/ssh_keys" \
    -H "Authorization: Bearer $HETZNER_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"wisechef-$CLIENT_ID\",\"public_key\":\"$SSH_PUB\"}")

SSH_KEY_ID=$(echo "$SSH_KEY_RESPONSE" | jq -r '.ssh_key.id // empty')
if [ -z "$SSH_KEY_ID" ]; then
    # Key might already exist
    SSH_KEY_ID=$(echo "$SSH_KEY_RESPONSE" | jq -r '.error.code // empty')
    if [ "$SSH_KEY_ID" = "uniqueness_error" ]; then
        SSH_KEY_ID=$(curl -s "https://api.hetzner.cloud/v1/ssh_keys" \
            -H "Authorization: Bearer $HETZNER_API_TOKEN" | \
            jq -r ".ssh_keys[] | select(.name==\"wisechef-$CLIENT_ID\") | .id")
        echo "🔑 Using existing SSH key: $SSH_KEY_ID"
    else
        echo "❌ Failed to upload SSH key: $SSH_KEY_RESPONSE"
        exit 1
    fi
else
    echo "🔑 SSH key uploaded: $SSH_KEY_ID"
fi

# Create server
echo "🖥️ Creating server wisechef-$CLIENT_ID..."
SERVER_RESPONSE=$(curl -s -X POST "https://api.hetzner.cloud/v1/servers" \
    -H "Authorization: Bearer $HETZNER_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"name\": \"wisechef-$CLIENT_ID\",
        \"server_type\": \"$SERVER_TYPE\",
        \"location\": \"$LOCATION\",
        \"image\": \"$IMAGE\",
        \"ssh_keys\": [$SSH_KEY_ID],
        \"labels\": {\"project\": \"wisechef\", \"client\": \"$CLIENT_ID\"}
    }")

SERVER_IP=$(echo "$SERVER_RESPONSE" | jq -r '.server.public_net.ipv4.ip // empty')
SERVER_HID=$(echo "$SERVER_RESPONSE" | jq -r '.server.id // empty')

if [ -z "$SERVER_IP" ]; then
    echo "❌ Failed to create server: $SERVER_RESPONSE"
    exit 1
fi

echo "✅ Server created: $SERVER_IP (ID: $SERVER_HID)"

# Save VPS details
jq ".clients |= map(if .id==\"$CLIENT_ID\" then .vps={\"ip\":\"$SERVER_IP\",\"id\":$SERVER_HID,\"type\":\"$SERVER_TYPE\",\"created\":\"$(date -Iseconds)\"} | .status=\"deployed\" else . end)" \
    "$REGISTRY" > "${REGISTRY}.tmp" && mv "${REGISTRY}.tmp" "$REGISTRY"

# Wait for server to be ready
echo "⏳ Waiting for server to boot..."
sleep 30

# Run remote setup
echo "🔧 Running remote setup..."
ssh -o StrictHostKeyChecking=no -i "$SSH_KEY_PATH" root@"$SERVER_IP" 'bash -s' < "$SCRIPT_DIR/setup-remote.sh"

echo ""
echo "🎉 WiseChef deployed for $CLIENT_NAME!"
echo "   IP: $SERVER_IP"
echo "   SSH: ssh -i $SSH_KEY_PATH root@$SERVER_IP"
