#!/bin/bash
# WiseChef Teardown — Destroys a client's VPS
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WISECHEF_DIR="$(dirname "$SCRIPT_DIR")"
source /home/adam/clawd/credentials/hetzner.env

CLIENT_ID="${1:?Usage: teardown.sh <client-id>}"
REGISTRY="$WISECHEF_DIR/clients/registry.json"

SERVER_HID=$(jq -r ".clients[] | select(.id==\"$CLIENT_ID\") | .vps.id // empty" "$REGISTRY")

if [ -z "$SERVER_HID" ]; then
    echo "❌ No VPS found for client '$CLIENT_ID'"
    exit 1
fi

echo "⚠️  About to destroy VPS for $CLIENT_ID (server ID: $SERVER_HID)"
read -p "Are you sure? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Cancelled."
    exit 0
fi

curl -s -X DELETE "https://api.hetzner.cloud/v1/servers/$SERVER_HID" \
    -H "Authorization: Bearer $HETZNER_API_TOKEN"

# Delete SSH key
SSH_KEY_NAME="wisechef-$CLIENT_ID"
SSH_KEY_ID=$(curl -s "https://api.hetzner.cloud/v1/ssh_keys" \
    -H "Authorization: Bearer $HETZNER_API_TOKEN" | \
    jq -r ".ssh_keys[] | select(.name==\"$SSH_KEY_NAME\") | .id // empty")
if [ -n "$SSH_KEY_ID" ]; then
    curl -s -X DELETE "https://api.hetzner.cloud/v1/ssh_keys/$SSH_KEY_ID" \
        -H "Authorization: Bearer $HETZNER_API_TOKEN"
fi

# Update registry
jq ".clients |= map(if .id==\"$CLIENT_ID\" then .vps=null | .status=\"teardown\" else . end)" \
    "$REGISTRY" > "${REGISTRY}.tmp" && mv "${REGISTRY}.tmp" "$REGISTRY"

echo "✅ VPS destroyed for $CLIENT_ID"
