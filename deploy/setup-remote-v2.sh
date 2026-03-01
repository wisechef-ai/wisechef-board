#!/bin/bash
# WiseChef Remote Setup v2 — Fully automated, no manual steps needed
# Runs on the client's VPS after provisioning
# Requires env vars: CLIENT_PHONE, CLIENT_NAME, ANTHROPIC_API_KEY
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "🔧 WiseChef VPS Setup v2 starting..."
echo "   Client: ${CLIENT_NAME:-unknown}"
echo "   Phone: ${CLIENT_PHONE:-unknown}"

# ============================================================
# 1. System updates + dependencies
# ============================================================
echo "📦 Installing dependencies..."
apt-get update -qq && apt-get upgrade -y -qq
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y -qq nodejs git jq build-essential qrencode

# ============================================================
# 1b. Install signal-cli (native Linux build, no Java needed)
# ============================================================
echo "📡 Installing signal-cli..."
SIGNAL_CLI_VERSION=$(curl -Ls -o /dev/null -w %{url_effective} https://github.com/AsamK/signal-cli/releases/latest | sed -e 's/^.*\/v//')
if [ -n "$SIGNAL_CLI_VERSION" ]; then
    cd /tmp
    curl -sL "https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}-Linux-native.tar.gz" -o signal-cli.tar.gz
    tar xzf signal-cli.tar.gz
    mv signal-cli /usr/local/bin/signal-cli 2>/dev/null || true
    chmod +x /usr/local/bin/signal-cli
    rm -f signal-cli.tar.gz
    echo "   signal-cli $(signal-cli --version 2>&1) installed"
else
    echo "   ⚠️ Could not detect signal-cli version, skipping"
fi

# ============================================================
# 2. Install OpenClaw
# ============================================================
echo "🦞 Installing OpenClaw..."
npm install -g openclaw

OPENCLAW_VERSION=$(openclaw --version 2>/dev/null || echo "unknown")
echo "   Installed: $OPENCLAW_VERSION"

# ============================================================
# 3. Create workspace with placeholder files
# ============================================================
echo "📁 Creating workspace..."
mkdir -p /opt/wisechef/clawd

# Placeholder files — will be overwritten by persona script
cat > /opt/wisechef/clawd/SOUL.md << 'SOUL'
# SOUL.md - WiseChef
You are WiseChef — a personal AI assistant. Be helpful, proactive, concise.
SOUL

cat > /opt/wisechef/clawd/IDENTITY.md << 'IDENTITY'
# IDENTITY.md
- **Name:** WiseChef
- **Creature:** Personal AI Assistant
- **Emoji:** 🧑‍🍳
IDENTITY

cat > /opt/wisechef/clawd/USER.md << 'USER'
# USER.md
(Will be populated from onboarding answers)
USER

# ============================================================
# 4. Configure OpenClaw — gateway, model, WhatsApp
# ============================================================
echo "⚙️ Configuring OpenClaw..."

# Run doctor first to generate base config
openclaw doctor --fix 2>&1 | tail -3

# Set model
openclaw config set agents.defaults.model.primary "anthropic/claude-sonnet-4-6" 2>&1 | tail -1

# Set workspace
openclaw config set agents.defaults.workspace "/opt/wisechef/clawd" 2>&1 | tail -1

# WiseChef branding — message prefix on all channels
openclaw config set messages.messagePrefix "[WiseChef]" 2>&1 | tail -1

# WhatsApp config — allowlist for client only
PHONE_DIGITS=$(echo "${CLIENT_PHONE:-}" | tr -d '+ -')
if [ -n "$PHONE_DIGITS" ]; then
    openclaw config set channels.whatsapp.dmPolicy "allowlist" 2>&1 | tail -1
    openclaw config set channels.whatsapp.allowFrom "[\"$PHONE_DIGITS\"]" 2>&1 | tail -1
fi

# ============================================================
# 5. Set API key in systemd environment
# ============================================================
echo "🔑 Setting API key..."
XDG_RUNTIME_DIR=/run/user/0

# For systemd user service
mkdir -p /root/.config/systemd/user/openclaw-gateway.service.d
cat > /root/.config/systemd/user/openclaw-gateway.service.d/env.conf << ENVEOF
[Service]
Environment=ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
ENVEOF

# Also set in shell profile for interactive use (openclaw tui, etc.)
grep -q "ANTHROPIC_API_KEY" /root/.bashrc 2>/dev/null || \
    echo "export ANTHROPIC_API_KEY='${ANTHROPIC_API_KEY}'" >> /root/.bashrc

# Set for current session too
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}"

# ============================================================
# 6. Fix device token (run doctor again after config changes)
# ============================================================
echo "🔧 Fixing device token..."
openclaw doctor --fix 2>&1 | tail -3

# ============================================================
# 7. Enable SSH password login for QR scanning
# ============================================================
echo "🔐 Configuring SSH access..."
sed -i 's/^#PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
sed -i 's/^PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config
grep -q "^PasswordAuthentication yes" /etc/ssh/sshd_config || \
    echo "PasswordAuthentication yes" >> /etc/ssh/sshd_config
systemctl restart ssh

# Generate and save password
ROOT_PASS=$(openssl rand -base64 12)
echo "root:$ROOT_PASS" | chpasswd

# ============================================================
# 8. Install QR pairing helper script
# ============================================================
echo "📱 Installing QR pairing script..."
cat > /usr/local/bin/wisechef-pair << 'QRSCRIPT'
#!/usr/bin/env node
// WiseChef WhatsApp Pairing — generates QR PNG for remote sending
const { makeWASocket, useMultiFileAuthState } = require("/usr/lib/node_modules/openclaw/node_modules/@whiskeysockets/baileys");
const { execSync } = require("child_process");
const fs = require("fs");

(async () => {
  console.log("🔗 Starting WhatsApp pairing...");
  console.log("   Waiting for QR code...\n");

  const { state, saveCreds } = await useMultiFileAuthState(
    process.env.HOME + "/.openclaw/credentials/whatsapp/default"
  );

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: ["WiseChef", "Desktop", "1.0"],
  });

  sock.ev.on("creds.update", saveCreds);

  let qrCount = 0;
  sock.ev.on("connection.update", (update) => {
    const { qr, connection, lastDisconnect } = update;
    if (qr) {
      qrCount++;
      fs.writeFileSync("/tmp/wa-qr-data.txt", qr);
      try {
        execSync("qrencode -o /tmp/wa-qr.png -s 10 -m 2 < /tmp/wa-qr-data.txt");
        console.log(`\n📸 QR #${qrCount} saved to /tmp/wa-qr.png`);
      } catch(e) {}
    }
    if (connection === "open") {
      console.log("\n✅ WhatsApp connected successfully!");
      console.log("   You can now close this and restart the gateway.");
      console.log("   Run: systemctl --user restart openclaw-gateway.service");
      setTimeout(() => process.exit(0), 3000);
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === 515) {
        console.log("\n🔄 Pairing restart requested (normal)...");
      } else {
        console.log(`\n❌ Connection closed (code ${code}). Try again.`);
        process.exit(1);
      }
    }
  });

  setTimeout(() => {
    console.log("\n⏰ Timeout after 3 minutes. Run again to retry.");
    process.exit(2);
  }, 180000);
})();
QRSCRIPT
chmod +x /usr/local/bin/wisechef-pair

# ============================================================
# 9. Install WiseChef Board (unified dashboard)
# ============================================================
echo "🎨 Installing WiseChef Board..."

cd /opt/wisechef
git clone https://github.com/wisechef-ai/wisechef-board.git board 2>&1 | tail -2
cd board
npm install --production=false 2>&1 | tail -3
npx vite build 2>&1 | tail -3

# Create .env — port 3333 (single service, tunnel points here)
GATEWAY_TOKEN=$(python3 -c "import json; print(json.load(open('/root/.openclaw/openclaw.json')).get('gateway',{}).get('auth',{}).get('token',''))" 2>/dev/null || echo "")
cat > .env << ENVEOF
PORT=3333
GATEWAY_TOKEN=${GATEWAY_TOKEN}
WORKSPACE_DIR=/opt/wisechef/clawd
HOST=127.0.0.1
ENVEOF

# Create systemd service
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
systemctl start wisechef-board
sleep 2
BOARD_STATUS=$(systemctl is-active wisechef-board 2>/dev/null || echo "failed")
echo "   Board: $BOARD_STATUS"

# ============================================================
# 10. Enable linger + set gateway mode + start service
# ============================================================
echo "🚀 Starting gateway..."

# Enable linger so user services survive SSH disconnect
loginctl enable-linger root

# Set gateway mode (required for startup)
openclaw config set gateway.mode local 2>&1 | tail -1

export XDG_RUNTIME_DIR=/run/user/0

# Install + start gateway service
openclaw gateway install 2>&1 | tail -3
systemctl --user daemon-reload
systemctl --user restart openclaw-gateway.service
sleep 5

# Verify
GATEWAY_STATUS=$(systemctl --user is-active openclaw-gateway.service 2>/dev/null || echo "failed")

# ============================================================
# 11. Output summary
# ============================================================
echo ""
echo "════════════════════════════════════════════"
echo "  ✅ WiseChef VPS Setup Complete!"
echo "════════════════════════════════════════════"
echo "  OpenClaw:    $OPENCLAW_VERSION"
echo "  Model:       anthropic/claude-sonnet-4-6"
echo "  Gateway:     $GATEWAY_STATUS"
echo "  Board:       $BOARD_STATUS"
echo "  Workspace:   /opt/wisechef/clawd"
echo "  SSH Pass:    $ROOT_PASS"
echo "  Client:      ${CLIENT_NAME:-unknown}"
echo "  Phone:       ${CLIENT_PHONE:-unknown}"
echo "════════════════════════════════════════════"
echo ""
echo "  Next: Run 'openclaw channels login' or"
echo "        'wisechef-pair' to link WhatsApp"
echo ""
echo "ROOT_PASSWORD:$ROOT_PASS"
