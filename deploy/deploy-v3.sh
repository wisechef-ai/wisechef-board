#!/bin/bash
# WiseChef Deploy Script v3 — End-to-end VPS provisioning
# Architecture: Hetzner VPS + CF Tunnel + WiseChef Board (unified)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WISECHEF_DIR="$(dirname "$SCRIPT_DIR")"
source /home/adam/clawd/credentials/hetzner.env
source /home/adam/clawd/wisechef/credentials/cloudflare.env   # CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
source /home/adam/clawd/wisechef/credentials/anthropic.env

CF_API_TOKEN="$CLOUDFLARE_API_TOKEN"
CF_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID"
CF_ZONE_ID="f8b7859f5939bb3ef50165ab5edcd749"

CLIENT_ID="${1:?Usage: deploy-v3.sh <client-id>}"
REGISTRY="$WISECHEF_DIR/clients/registry.json"

# Config
SERVER_TYPE="ccx13"   # 2 dedicated CPU, 8GB RAM
IMAGE="ubuntu-24.04"
DOMAIN="wisechef.ai"
CF_ACCESS_APP_ID="60688678-62f0-4d63-9f6b-30d98b3940dd"
CF_ACCESS_POLICY_ID="ecac748f-b7b0-421b-996c-76f17bb5cf81"

echo "🚀 Deploying WiseChef for client: $CLIENT_ID"

# ── 1. Get client info from registry ──
CLIENT_NAME=$(jq -r ".clients[] | select(.id==\"$CLIENT_ID\") | .name" "$REGISTRY")
CLIENT_PHONE=$(jq -r ".clients[] | select(.id==\"$CLIENT_ID\") | .phone" "$REGISTRY")
CLIENT_EMAIL=$(jq -r ".clients[] | select(.id==\"$CLIENT_ID\") | .email // empty" "$REGISTRY")
if [ -z "$CLIENT_NAME" ] || [ "$CLIENT_NAME" = "null" ]; then
    echo "❌ Client '$CLIENT_ID' not found in registry"
    exit 1
fi
echo "📋 Client: $CLIENT_NAME ($CLIENT_PHONE) <$CLIENT_EMAIL>"

# ── 2. SSH key ──
SSH_KEY_PATH="$WISECHEF_DIR/clients/$CLIENT_ID/ssh_key"
mkdir -p "$WISECHEF_DIR/clients/$CLIENT_ID"
if [ ! -f "$SSH_KEY_PATH" ]; then
    ssh-keygen -t ed25519 -f "$SSH_KEY_PATH" -N "" -C "wisechef-$CLIENT_ID"
    echo "🔑 SSH key generated"
fi
SSH_PUB=$(cat "${SSH_KEY_PATH}.pub")

# Upload SSH key to Hetzner (delete existing with same name first)
echo "☁️ Uploading SSH key..."
# Check if key with this name exists and delete it to avoid stale keys
EXISTING_KEY_ID=$(curl -s "https://api.hetzner.cloud/v1/ssh_keys" \
    -H "Authorization: Bearer $HETZNER_API_TOKEN" | \
    jq -r ".ssh_keys[] | select(.name==\"wisechef-$CLIENT_ID\") | .id // empty")
if [ -n "$EXISTING_KEY_ID" ]; then
    curl -s -X DELETE "https://api.hetzner.cloud/v1/ssh_keys/$EXISTING_KEY_ID" \
        -H "Authorization: Bearer $HETZNER_API_TOKEN" > /dev/null
fi

SSH_KEY_RESPONSE=$(curl -s -X POST "https://api.hetzner.cloud/v1/ssh_keys" \
    -H "Authorization: Bearer $HETZNER_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"wisechef-$CLIENT_ID\",\"public_key\":\"$SSH_PUB\"}")

SSH_KEY_ID=$(echo "$SSH_KEY_RESPONSE" | jq -r '.ssh_key.id // empty')
if [ -z "$SSH_KEY_ID" ]; then
    # Fingerprint collision — same key uploaded under different name, find it
    FINGERPRINT=$(ssh-keygen -lf "${SSH_KEY_PATH}.pub" -E md5 | awk '{print $2}' | sed 's/MD5://')
    SSH_KEY_ID=$(curl -s "https://api.hetzner.cloud/v1/ssh_keys" \
        -H "Authorization: Bearer $HETZNER_API_TOKEN" | \
        jq -r ".ssh_keys[] | select(.fingerprint==\"$FINGERPRINT\") | .id")
    if [ -n "$SSH_KEY_ID" ]; then
        echo "🔑 Using existing key (same fingerprint): $SSH_KEY_ID"
    else
        echo "❌ SSH key error: $SSH_KEY_RESPONSE"
        exit 1
    fi
else
    echo "🔑 SSH key uploaded: $SSH_KEY_ID"
fi

# ── 3. Create Hetzner VPS ──
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

# Update registry with VPS info
jq ".clients |= map(if .id==\"$CLIENT_ID\" then .vps={\"ip\":\"$SERVER_IP\",\"id\":$SERVER_HID,\"type\":\"$SERVER_TYPE\",\"location\":\"$LOCATION\",\"created\":\"$(date -Iseconds)\"} | .status=\"deploying\" else . end)" \
    "$REGISTRY" > "${REGISTRY}.tmp" && mv "${REGISTRY}.tmp" "$REGISTRY"

# ── 4. Create Cloudflare Tunnel ──
echo "🔗 Creating CF tunnel..."
TUNNEL_RESPONSE=$(curl -s -X POST \
    "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/cfd_tunnel" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"wisechef-$CLIENT_ID\",\"tunnel_secret\":\"$(openssl rand -base64 32)\",\"config_src\":\"cloudflare\"}")

TUNNEL_ID=$(echo "$TUNNEL_RESPONSE" | jq -r '.result.id // empty')
TUNNEL_TOKEN=$(echo "$TUNNEL_RESPONSE" | jq -r '.result.token // empty')
if [ -z "$TUNNEL_ID" ]; then
    echo "❌ Tunnel creation failed: $TUNNEL_RESPONSE"
    exit 1
fi
echo "   Tunnel: $TUNNEL_ID"

# Save tunnel token
echo "$TUNNEL_TOKEN" > "$WISECHEF_DIR/clients/$CLIENT_ID/tunnel_token"

# Configure tunnel ingress
echo "   Configuring tunnel ingress..."
curl -s -X PUT \
    "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"config\":{\"ingress\":[{\"hostname\":\"$CLIENT_ID.$DOMAIN\",\"service\":\"http://127.0.0.1:3333\"},{\"service\":\"http_status:404\"}]}}" > /dev/null

# ── 5. Create or update DNS CNAME ──
echo "🌐 Setting DNS record..."
EXISTING_DNS_ID=$(curl -s "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records?name=$CLIENT_ID.$DOMAIN" \
    -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result[0].id // empty')
if [ -n "$EXISTING_DNS_ID" ]; then
    curl -s -X PUT \
        "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records/$EXISTING_DNS_ID" \
        -H "Authorization: Bearer $CF_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"type\":\"CNAME\",\"name\":\"$CLIENT_ID\",\"content\":\"$TUNNEL_ID.cfargotunnel.com\",\"proxied\":true}" > /dev/null
    echo "   $CLIENT_ID.$DOMAIN → tunnel (updated existing)"
else
    curl -s -X POST \
        "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
        -H "Authorization: Bearer $CF_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"type\":\"CNAME\",\"name\":\"$CLIENT_ID\",\"content\":\"$TUNNEL_ID.cfargotunnel.com\",\"proxied\":true}" > /dev/null
    echo "   $CLIENT_ID.$DOMAIN → tunnel (created)"
fi

# ── 6. Add client email to CF Access policy ──
if [ -n "$CLIENT_EMAIL" ]; then
    echo "🔐 Adding $CLIENT_EMAIL to CF Access policy..."
    # Get current policy include rules
    POLICY_JSON=$(curl -s \
        "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/access/apps/$CF_ACCESS_APP_ID/policies/$CF_ACCESS_POLICY_ID" \
        -H "Authorization: Bearer $CF_API_TOKEN")

    # Check if email already in policy
    if echo "$POLICY_JSON" | jq -e ".result.include[] | select(.email.email==\"$CLIENT_EMAIL\")" > /dev/null 2>&1; then
        echo "   ✅ Email already in policy"
    else
        # Build new include array: existing + new email
        NEW_INCLUDE=$(echo "$POLICY_JSON" | jq ".result.include + [{\"email\":{\"email\":\"$CLIENT_EMAIL\"}}]")
        POLICY_NAME=$(echo "$POLICY_JSON" | jq -r '.result.name')
        POLICY_DECISION=$(echo "$POLICY_JSON" | jq -r '.result.decision')

        curl -s -X PUT \
            "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/access/apps/$CF_ACCESS_APP_ID/policies/$CF_ACCESS_POLICY_ID" \
            -H "Authorization: Bearer $CF_API_TOKEN" \
            -H "Content-Type: application/json" \
            -d "{\"name\":\"$POLICY_NAME\",\"decision\":\"$POLICY_DECISION\",\"include\":$NEW_INCLUDE}" > /dev/null
        echo "   ✅ Email added to access policy"
    fi
fi

# ── 7. Wait for server boot ──
echo "⏳ Waiting for server to boot..."
# Clean stale host key (IPs may be recycled)
ssh-keygen -R "$SERVER_IP" 2>/dev/null || true
for i in $(seq 1 12); do
    if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -i "$SSH_KEY_PATH" root@"$SERVER_IP" 'echo ok' 2>/dev/null; then
        echo "   Server is ready!"
        break
    fi
    echo "   Waiting... ($i/12)"
    sleep 10
done

# ── 8. Run remote setup ──
echo "🔧 Running remote setup..."
ssh -o StrictHostKeyChecking=no -i "$SSH_KEY_PATH" root@"$SERVER_IP" \
    "export CLIENT_NAME='$CLIENT_NAME' CLIENT_PHONE='$CLIENT_PHONE' ANTHROPIC_API_KEY='$ANTHROPIC_API_KEY'; bash -s" \
    < "$SCRIPT_DIR/setup-remote-v2.sh" 2>&1 | tee "/tmp/wisechef-deploy-$CLIENT_ID.log"

# Extract root password from output
ROOT_PASS=$(grep "^ROOT_PASSWORD:" "/tmp/wisechef-deploy-$CLIENT_ID.log" | cut -d: -f2)

# ── 9. Install cloudflared on VPS ──
echo "☁️ Installing cloudflared..."
ssh -o StrictHostKeyChecking=no -i "$SSH_KEY_PATH" root@"$SERVER_IP" bash <<CFDEOF
curl -sL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared \$(lsb_release -cs) main" > /etc/apt/sources.list.d/cloudflared.list
apt-get update -qq && apt-get install -y -qq cloudflared

# Install tunnel as service
cloudflared service install $TUNNEL_TOKEN
systemctl enable cloudflared
systemctl start cloudflared
sleep 2
echo "   cloudflared: \$(systemctl is-active cloudflared)"
CFDEOF

# ── 10. Configure gateway allowed origins ──
echo "🔒 Setting gateway allowed origins..."
ssh -o StrictHostKeyChecking=no -i "$SSH_KEY_PATH" root@"$SERVER_IP" \
    "openclaw config set controlUi.allowedOrigins '[\"https://$CLIENT_ID.$DOMAIN\"]' 2>&1 | tail -1"

# ── 11. Sync registry to portal ──
echo "📡 Syncing registry to portal..."
scp -o StrictHostKeyChecking=no -i "$WISECHEF_DIR/clients/cezary/ssh_key" \
    "$REGISTRY" root@65.109.168.10:/opt/wisechef/registry.json 2>/dev/null || \
    echo "   ⚠️ Portal sync failed (non-fatal)"

# ── 12. Save deployment info ──
cat > "$WISECHEF_DIR/clients/$CLIENT_ID/deployment.json" << DEPEOF
{
  "ip": "$SERVER_IP",
  "server_id": $SERVER_HID,
  "server_type": "$SERVER_TYPE",
  "location": "$LOCATION",
  "tunnel_id": "$TUNNEL_ID",
  "root_password": "$ROOT_PASS",
  "portal_url": "https://${CLIENT_ID}.$DOMAIN",
  "ssh_key": "$SSH_KEY_PATH",
  "deployed_at": "$(date -Iseconds)",
  "model": "anthropic/claude-sonnet-4-6",
  "phone": "$CLIENT_PHONE",
  "email": "$CLIENT_EMAIL",
  "status": "deployed_awaiting_onboarding"
}
DEPEOF

# Update registry status
jq ".clients |= map(if .id==\"$CLIENT_ID\" then .status=\"deployed\" else . end)" \
    "$REGISTRY" > "${REGISTRY}.tmp" && mv "${REGISTRY}.tmp" "$REGISTRY"

echo ""
echo "🎉 WiseChef deployed for $CLIENT_NAME!"
echo "════════════════════════════════════════════"
echo "   IP:       $SERVER_IP"
echo "   Portal:   https://${CLIENT_ID}.$DOMAIN"
echo "   SSH:      ssh -i $SSH_KEY_PATH root@$SERVER_IP"
echo "   SSH Pass: $ROOT_PASS"
echo "   Tunnel:   $TUNNEL_ID"
echo "   Phone:    $CLIENT_PHONE"
echo "   Email:    $CLIENT_EMAIL"
echo "════════════════════════════════════════════"
echo ""
echo "   Client flow:"
echo "   1. Open https://${CLIENT_ID}.$DOMAIN"
echo "   2. Authenticate via CF Access (email OTP)"
echo "   3. Complete onboarding wizard"
echo "   4. Link messaging channels"
echo "   5. Done! 🎉"
