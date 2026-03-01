#!/bin/bash
# WiseChef Caddy Setup — Installs Caddy + configures reverse proxy with TLS + basic auth
# Runs ON the client VPS. Requires: CLIENT_SUBDOMAIN, CLIENT_USER, CLIENT_PASS
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "🔒 Setting up Caddy reverse proxy..."
echo "   Subdomain: ${CLIENT_SUBDOMAIN:?Required: CLIENT_SUBDOMAIN}"
echo "   User: ${CLIENT_USER:?Required: CLIENT_USER}"
: "${CLIENT_PASS:?Required: CLIENT_PASS}"

# 1. Install Caddy
if ! command -v caddy &>/dev/null; then
    echo "📦 Installing Caddy..."
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    apt-get update -qq
    apt-get install -y -qq caddy
    echo "   ✅ Caddy installed: $(caddy version)"
else
    echo "   ✅ Caddy already installed: $(caddy version)"
fi

# 2. Generate bcrypt hash
echo "🔑 Generating password hash..."
PASS_HASH=$(caddy hash-password --plaintext "$CLIENT_PASS")

# 3. Write Caddyfile
echo "📝 Writing Caddyfile..."
cat > /etc/caddy/Caddyfile << CADDYEOF
${CLIENT_SUBDOMAIN} {
    basic_auth * {
        ${CLIENT_USER} ${PASS_HASH}
    }

    reverse_proxy 127.0.0.1:3333

    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
        -Server
    }

    log {
        output file /var/log/caddy/access.log {
            roll_size 10mb
            roll_keep 3
        }
    }
}
CADDYEOF

mkdir -p /var/log/caddy

# 4. Validate Caddyfile
echo "✅ Validating Caddyfile..."
caddy validate --config /etc/caddy/Caddyfile

# 5. Open firewall if ufw is active
if ufw status 2>/dev/null | grep -q "Status: active"; then
    echo "🔥 Opening firewall ports 80, 443..."
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
fi

# 6. Start Caddy
echo "🚀 Starting Caddy..."
systemctl enable caddy
systemctl restart caddy
sleep 2

if systemctl is-active caddy >/dev/null 2>&1; then
    echo ""
    echo "════════════════════════════════════════════"
    echo "  ✅ Caddy configured!"
    echo "════════════════════════════════════════════"
    echo "  URL:  https://${CLIENT_SUBDOMAIN}"
    echo "  User: ${CLIENT_USER}"
    echo "  TLS:  Auto (Let's Encrypt)"
    echo "════════════════════════════════════════════"
else
    echo "❌ Caddy failed to start!"
    journalctl -u caddy --no-pager -n 10
    exit 1
fi
