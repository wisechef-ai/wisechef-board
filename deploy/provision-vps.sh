#!/bin/bash
# WiseChef VPS Provisioning — From bare Hetzner to running enterprise
# Usage: provision-vps.sh <VPS_IP> [options]
#
# Prerequisites on BUILD HOST (wisechef-hq):
#   - Docker with wisechef/agent:latest image
#   - SSH key access to the VPS (root)
#   - Cloudflare API token
#
# What it does:
#   1. Installs Docker on the VPS
#   2. Transfers the Docker image
#   3. Creates Cloudflare tunnel
#   4. Starts the container with enterprise tier
#   5. Waits for health checks
#   6. Outputs the access URL

set -euo pipefail

# ── Configuration ──
VPS_IP="${1:?Usage: $0 <VPS_IP> [--name CLIENT_NAME] [--plan PLAN] [--hostname HOSTNAME]}"
shift

# Defaults
CLIENT_NAME="WiseChef Dev"
PLAN="enterprise"
HOSTNAME="dev"
DOMAIN="wisechef.ai"
MODEL="openrouter/anthropic/claude-sonnet-4"
CF_ACCOUNT_ID="ba11aeeeafa20f32096559c37aa367b2"
CF_ZONE_ID="f8b7859f5939bb3ef50165ab5edcd749"
MEMORY_LIMIT="4g"
SSH_USER="root"
IMAGE_TAG="latest"

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --name) CLIENT_NAME="$2"; shift 2 ;;
    --plan) PLAN="$2"; shift 2 ;;
    --hostname) HOSTNAME="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --memory) MEMORY_LIMIT="$2"; shift 2 ;;
    --image) IMAGE_TAG="$2"; shift 2 ;;
    --ssh-user) SSH_USER="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

FQDN="${HOSTNAME}.${DOMAIN}"
CONTAINER_NAME="wisechef-${HOSTNAME}"
TUNNEL_NAME="wisechef-${HOSTNAME}-tunnel"

# Required env vars
: "${CF_API_TOKEN:?Set CF_API_TOKEN for Cloudflare API access}"
: "${OPENROUTER_API_KEY:?Set OPENROUTER_API_KEY}"

# Optional
OPENROUTER_MANAGEMENT_KEY="${OPENROUTER_MANAGEMENT_KEY:-}"
GATEWAY_TOKEN="${GATEWAY_TOKEN:-$(openssl rand -hex 16)}"

echo "═══════════════════════════════════════════════════════"
echo "  WiseChef VPS Provisioner"
echo "═══════════════════════════════════════════════════════"
echo "  VPS:       ${SSH_USER}@${VPS_IP}"
echo "  Client:    ${CLIENT_NAME}"
echo "  Plan:      ${PLAN}"
echo "  Hostname:  ${FQDN}"
echo "  Model:     ${MODEL}"
echo "  Container: ${CONTAINER_NAME}"
echo "  Memory:    ${MEMORY_LIMIT}"
echo "  Image:     wisechef/agent:${IMAGE_TAG}"
echo "  Gateway:   ${GATEWAY_TOKEN}"
echo "═══════════════════════════════════════════════════════"
echo ""
read -p "Continue? [y/N] " -n 1 -r
echo
[[ $REPLY =~ ^[Yy]$ ]] || exit 0

# ── Step 1: Install Docker on VPS ──
echo ""
echo "═══ Step 1/6: Installing Docker on VPS ═══"
ssh -o StrictHostKeyChecking=no ${SSH_USER}@${VPS_IP} bash <<'DOCKER_INSTALL'
if command -v docker &>/dev/null; then
  echo "Docker already installed: $(docker --version)"
else
  echo "Installing Docker..."
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable docker
  systemctl start docker
  echo "Docker installed: $(docker --version)"
fi
DOCKER_INSTALL

# ── Step 2: Transfer Docker image ──
echo ""
echo "═══ Step 2/6: Transferring Docker image ═══"
echo "Streaming wisechef/agent:${IMAGE_TAG} to VPS (this may take a few minutes)..."
docker save wisechef/agent:${IMAGE_TAG} | ssh -o Compression=no ${SSH_USER}@${VPS_IP} "docker load"
ssh ${SSH_USER}@${VPS_IP} "docker tag wisechef/agent:${IMAGE_TAG} wisechef/agent:latest 2>/dev/null || true"
echo "✅ Image transferred"

# ── Step 3: Create Cloudflare tunnel ──
echo ""
echo "═══ Step 3/6: Creating Cloudflare tunnel ═══"

# Create tunnel via API
TUNNEL_RESPONSE=$(curl -sf "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/cfd_tunnel" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"${TUNNEL_NAME}\",
    \"tunnel_secret\": \"$(openssl rand -base64 32)\"
  }")

TUNNEL_ID=$(echo "$TUNNEL_RESPONSE" | jq -r '.result.id')
TUNNEL_TOKEN=$(echo "$TUNNEL_RESPONSE" | jq -r '.result.token')

if [[ -z "$TUNNEL_ID" || "$TUNNEL_ID" == "null" ]]; then
  echo "❌ Failed to create tunnel"
  echo "$TUNNEL_RESPONSE" | jq .
  exit 1
fi
echo "Tunnel created: ${TUNNEL_ID}"

# Configure tunnel routing
curl -sf -X PUT "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/configurations" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"config\": {
      \"ingress\": [
        {
          \"hostname\": \"${FQDN}\",
          \"service\": \"http://localhost:3333\",
          \"originRequest\": { \"noTLSVerify\": true }
        },
        { \"service\": \"http_status:404\" }
      ]
    }
  }" > /dev/null

echo "Tunnel configured for ${FQDN} → localhost:3333"

# ── Step 4: Create DNS record ──
echo ""
echo "═══ Step 4/6: Creating DNS record ═══"

# Delete existing CNAME if any
EXISTING=$(curl -sf "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records?type=CNAME&name=${FQDN}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq -r '.result[0].id // empty')

if [[ -n "$EXISTING" ]]; then
  curl -sf -X DELETE "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records/${EXISTING}" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" > /dev/null
  echo "Removed old DNS record"
fi

# Create CNAME pointing to tunnel
curl -sf -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"CNAME\",
    \"name\": \"${HOSTNAME}\",
    \"content\": \"${TUNNEL_ID}.cfargotunnel.com\",
    \"ttl\": 1,
    \"proxied\": true
  }" > /dev/null

echo "DNS: ${FQDN} → ${TUNNEL_ID}.cfargotunnel.com ✅"

# ── Step 5: Start containers ──
echo ""
echo "═══ Step 5/6: Starting containers ═══"

ssh ${SSH_USER}@${VPS_IP} bash <<REMOTE_START
set -e

# Create data directories
mkdir -p /opt/wisechef/clients/${HOSTNAME}/{workspace,openclaw}

# Generate manifest
cat > /opt/wisechef/clients/${HOSTNAME}/manifest.json <<MANIFEST
{
  "clientName": "${CLIENT_NAME}",
  "plan": "${PLAN}",
  "hostname": "${FQDN}",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
MANIFEST

# Start cloudflared tunnel
docker run -d --name ${CONTAINER_NAME}-tunnel \
  --restart=unless-stopped \
  cloudflare/cloudflared:latest \
  tunnel --no-autoupdate run --token ${TUNNEL_TOKEN}

echo "Tunnel container started"

# Start WiseChef container
docker run -d --name ${CONTAINER_NAME} \
  --memory=${MEMORY_LIMIT} \
  --restart=unless-stopped \
  --network=host \
  -e WISECHEF_PLAN=${PLAN} \
  -e WISECHEF_MODEL=${MODEL} \
  -e OPENROUTER_API_KEY=${OPENROUTER_API_KEY} \
  -e OPENROUTER_MANAGEMENT_KEY=${OPENROUTER_MANAGEMENT_KEY} \
  -e GATEWAY_TOKEN=${GATEWAY_TOKEN} \
  -e CLIENT_NAME="${CLIENT_NAME}" \
  -e CLIENT_CHANNEL=whatsapp \
  -v /opt/wisechef/clients/${HOSTNAME}/workspace:/opt/wisechef/workspace \
  -v /opt/wisechef/clients/${HOSTNAME}/openclaw:/root/.openclaw \
  -v /opt/wisechef/clients/${HOSTNAME}/manifest.json:/opt/wisechef/manifest.json \
  wisechef/agent:latest

echo "WiseChef container started"
REMOTE_START

# ── Step 6: Wait for health ──
echo ""
echo "═══ Step 6/6: Waiting for services ═══"

echo -n "Waiting for startup"
for i in $(seq 1 90); do
  HEALTH=$(ssh ${SSH_USER}@${VPS_IP} "curl -sf http://127.0.0.1:3333/health 2>/dev/null | jq -r '.status' 2>/dev/null" || true)
  if [[ "$HEALTH" == "ok" ]]; then
    echo ""
    echo "✅ Board healthy after ${i}s"
    break
  fi
  echo -n "."
  sleep 2
done

GW_HEALTH=$(ssh ${SSH_USER}@${VPS_IP} "curl -sf http://127.0.0.1:18789/health 2>/dev/null" || echo "not ready")
PP_HEALTH=$(ssh ${SSH_USER}@${VPS_IP} "curl -sf http://127.0.0.1:3100/api/health 2>/dev/null | jq -r '.status' 2>/dev/null" || echo "not ready")

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✅ WiseChef Provisioned!"
echo "═══════════════════════════════════════════════════════"
echo "  URL:       https://${FQDN}"
echo "  Gateway:   ${GW_HEALTH}"
echo "  Paperclip: ${PP_HEALTH}"
echo "  Plan:      ${PLAN}"
echo "  Model:     ${MODEL}"
echo "  Token:     ${GATEWAY_TOKEN}"
echo "  Tunnel:    ${TUNNEL_ID}"
echo ""
echo "  SSH:       ssh ${SSH_USER}@${VPS_IP}"
echo "  Logs:      docker logs ${CONTAINER_NAME}"
echo "  Stats:     docker stats ${CONTAINER_NAME}"
echo "═══════════════════════════════════════════════════════"

# Save deployment info
cat > /tmp/wisechef-deploy-${HOSTNAME}.json <<DEPLOY
{
  "hostname": "${FQDN}",
  "vps_ip": "${VPS_IP}",
  "container": "${CONTAINER_NAME}",
  "tunnel_id": "${TUNNEL_ID}",
  "gateway_token": "${GATEWAY_TOKEN}",
  "plan": "${PLAN}",
  "model": "${MODEL}",
  "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
DEPLOY
echo "Deployment info saved to /tmp/wisechef-deploy-${HOSTNAME}.json"
