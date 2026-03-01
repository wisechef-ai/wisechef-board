#!/bin/bash
# WiseChef Remote Setup — Runs on the client's VPS after provisioning
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "🔧 WiseChef VPS Setup starting..."

# System updates
apt-get update -qq && apt-get upgrade -y -qq

# Install Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y -qq nodejs git jq build-essential

# Install OpenClaw
npm install -g openclaw

# Create workspace
mkdir -p /opt/wisechef/clawd
cd /opt/wisechef/clawd

# Initialize OpenClaw workspace
cat > SOUL.md << 'SOUL'
# SOUL.md - WiseChef

You are WiseChef — a personal AI assistant tailored for your human.
Be helpful, proactive, and respectful. You manage their calendar, emails, tasks, and whatever they need.
Keep it concise. Be smart about when to reach out.
SOUL

cat > IDENTITY.md << 'IDENTITY'
# IDENTITY.md
- **Name:** WiseChef
- **Creature:** Personal AI Assistant
- **Vibe:** Professional, Proactive, Friendly
- **Emoji:** 👨‍🍳
IDENTITY

cat > USER.md << 'USER'
# USER.md
(Will be populated from onboarding answers)
USER

# Set up systemd service for OpenClaw
cat > /etc/systemd/system/wisechef.service << 'SERVICE'
[Unit]
Description=WiseChef OpenClaw Agent
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/wisechef/clawd
ExecStart=/usr/bin/openclaw gateway start --foreground
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable wisechef

# Clone dashboard
cd /opt/wisechef
git clone https://github.com/madrzak/vidclaw dashboard 2>/dev/null || true
cd dashboard
npm install --production 2>/dev/null || true
npm run build 2>/dev/null || true

echo "✅ WiseChef VPS setup complete!"
echo "   OpenClaw installed: $(openclaw --version 2>/dev/null || echo 'check manually')"
echo "   Dashboard: /opt/wisechef/dashboard"
echo "   Workspace: /opt/wisechef/clawd"
echo "   Service: wisechef.service (enabled, not started — needs config first)"
