#!/bin/bash
set -euo pipefail

# WiseChef HQ VPS Setup Script
# Installs: Node.js 22, OpenClaw, wisechef-board, bot-gateway, company workspace
# Target: wisechef user on Ubuntu 24.04

echo "=== WiseChef HQ Setup ==="
echo "Date: $(date -u)"

# --- System packages ---
echo ">>> Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y -qq curl git jq ufw build-essential

# --- Node.js 22 ---
echo ">>> Installing Node.js 22..."
if ! command -v node &>/dev/null || [[ "$(node -v)" != v22* && "$(node -v)" != v24* ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y -qq nodejs
fi
echo "Node: $(node -v), npm: $(npm -v)"

# --- npm global setup ---
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
export PATH="$HOME/.npm-global/bin:$PATH"
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc

# --- OpenClaw ---
echo ">>> Installing OpenClaw..."
npm install -g openclaw@latest 2>&1 | tail -3
echo "OpenClaw: $(openclaw --version 2>/dev/null || echo 'installed')"

# --- UFW Firewall ---
echo ">>> Configuring firewall..."
sudo ufw allow ssh
sudo ufw allow 3334/tcp  # wisechef-board
sudo ufw --force enable

# --- Directory structure ---
echo ">>> Creating directory structure..."
mkdir -p ~/companies/wisechef/{agents,config,memory,skills,bot-gateway,dashboard,tiktok-marketing}
mkdir -p ~/companies/wisechef/wisechef-board
mkdir -p ~/clawd/wisechef/{clients,credentials,deploy,docs,onboarding,portal}
mkdir -p ~/.openclaw/agents

echo "=== Base setup complete ==="
echo "Next: transfer company files and configure agents"
