#!/bin/bash
# WiseChef Persona Generator — Creates SOUL.md + USER.md from onboarding data
# Usage: write-persona.sh <client-id>
set -euo pipefail

WISECHEF_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLIENT_ID="${1:?Usage: write-persona.sh <client-id>}"
CLIENT_DIR="$WISECHEF_DIR/clients/$CLIENT_ID"
ONBOARDING="$CLIENT_DIR/onboarding.md"
DEPLOYMENT="$CLIENT_DIR/deployment.json"

if [ ! -f "$ONBOARDING" ]; then
    echo "❌ No onboarding.md found for $CLIENT_ID"
    exit 1
fi

if [ ! -f "$DEPLOYMENT" ]; then
    echo "❌ No deployment.json found for $CLIENT_ID — deploy first"
    exit 1
fi

VPS_IP=$(jq -r '.ip' "$DEPLOYMENT")
SSH_KEY=$(jq -r '.ssh_key' "$DEPLOYMENT")

echo "📝 Writing persona files for $CLIENT_ID to VPS $VPS_IP..."

# Copy onboarding.md to VPS for reference
scp -o StrictHostKeyChecking=no -i "$SSH_KEY" "$ONBOARDING" root@"$VPS_IP":/opt/wisechef/clawd/onboarding-answers.md

# Copy local SOUL.md and USER.md if they exist in client dir
if [ -f "$CLIENT_DIR/SOUL.md" ]; then
    scp -o StrictHostKeyChecking=no -i "$SSH_KEY" "$CLIENT_DIR/SOUL.md" root@"$VPS_IP":/opt/wisechef/clawd/SOUL.md
    echo "   ✅ SOUL.md uploaded"
fi

if [ -f "$CLIENT_DIR/USER.md" ]; then
    scp -o StrictHostKeyChecking=no -i "$SSH_KEY" "$CLIENT_DIR/USER.md" root@"$VPS_IP":/opt/wisechef/clawd/USER.md
    echo "   ✅ USER.md uploaded"
fi

if [ -f "$CLIENT_DIR/IDENTITY.md" ]; then
    scp -o StrictHostKeyChecking=no -i "$SSH_KEY" "$CLIENT_DIR/IDENTITY.md" root@"$VPS_IP":/opt/wisechef/clawd/IDENTITY.md
    echo "   ✅ IDENTITY.md uploaded"
fi

echo "✅ Persona files written to $VPS_IP:/opt/wisechef/clawd/"
echo "   Restart gateway to pick up changes:"
echo "   ssh -i $SSH_KEY root@$VPS_IP 'export XDG_RUNTIME_DIR=/run/user/0; systemctl --user restart openclaw-gateway.service'"
