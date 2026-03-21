#!/bin/bash
# WiseChef Always-On Skill Bundle Installer
# Installs the standard skill set for every WiseChef agent container
set -euo pipefail

WORKSPACE="${WORKSPACE:-/opt/wisechef/clawd}"
SKILLS_DIR="$WORKSPACE/skills"
COGNEE_HOME="${COGNEE_HOME:-/opt/wisechef/cognee}"

echo "🛠️ Installing WiseChef Always-On Skill Bundle"

mkdir -p "$SKILLS_DIR"

# Skills to install via clawdhub
SKILLS=(
  "scrapling"
  "tdd-guide"
  "self-improving-agent"
  "summarize"
  "weather"
)

# Install skills from clawdhub
if command -v clawdhub &>/dev/null; then
  for skill in "${SKILLS[@]}"; do
    echo "  📦 Installing: $skill"
    clawdhub install "$skill" --dir "$SKILLS_DIR" 2>/dev/null || echo "  ⚠️ Failed to install $skill (may already exist)"
  done
else
  echo "  ⚠️ clawdhub not found — install via: npm install -g clawdhub"
  echo "  Falling back to directory creation..."
  for skill in "${SKILLS[@]}"; do
    mkdir -p "$SKILLS_DIR/$skill"
    echo "  📁 Created skill directory: $skill"
  done
fi

# Install Cognee (separate package)
if [ -f "$(dirname "$0")/../../wisechef-cognee-container/install.sh" ]; then
  echo "  📦 Installing Cognee-Lite..."
  bash "$(dirname "$0")/../../wisechef-cognee-container/install.sh"
elif [ -d "$COGNEE_HOME" ]; then
  echo "  ✅ Cognee already installed at $COGNEE_HOME"
else
  echo "  ⚠️ Cognee install script not found — install manually"
fi

# Install AutoResearch cron
AUTORESEARCH_SCRIPT="$(dirname "$0")/autoresearch.sh"
if [ -f "$AUTORESEARCH_SCRIPT" ]; then
  cp "$AUTORESEARCH_SCRIPT" "$WORKSPACE/scripts/autoresearch.sh" 2>/dev/null || true
  chmod +x "$WORKSPACE/scripts/autoresearch.sh" 2>/dev/null || true
  
  # Add daily cron at 8 AM
  if command -v crontab &>/dev/null; then
    (crontab -l 2>/dev/null; echo "0 8 * * * WORKSPACE=$WORKSPACE BOARD_URL=\${BOARD_URL:-http://localhost:3333} OPENROUTER_API_KEY=\${OPENROUTER_API_KEY} $WORKSPACE/scripts/autoresearch.sh >> $WORKSPACE/autoresearch/cron.log 2>&1") | sort -u | crontab -
    echo "  ⏰ AutoResearch cron installed (8 AM daily)"
  fi
fi

# Create AgentPact client config
AGENTPACT_CONFIG="$WORKSPACE/.agentpact.json"
if [ ! -f "$AGENTPACT_CONFIG" ]; then
  cat > "$AGENTPACT_CONFIG" << 'JSON'
{
  "api_url": "https://api.agentpact.xyz",
  "mcp_url": "https://mcp.agentpact.xyz",
  "mode": "client",
  "auto_discover": true,
  "budget": {
    "monthly_limit_usd": 50,
    "per_task_limit_usd": 10,
    "require_approval_above_usd": 20
  }
}
JSON
  echo "  📝 AgentPact client config created"
fi

echo ""
echo "✅ Always-On Skill Bundle installed!"
echo ""
echo "Included skills:"
echo "  📎 Cognee — Knowledge graph (local)"
echo "  🔬 AutoResearch — Self-improving prompts (daily)"
echo "  🤝 AgentPact — Contractor discovery & hiring"
echo "  🕸️ Scrapling — JS-heavy web scraping"
echo "  🧪 TDD/Verify — Code quality guardrails"
echo "  📈 Self-Improvement — Trajectory tips, learning capture"
echo "  📄 Summarize — URLs, PDFs, YouTube, audio"
echo "  🌤️ Weather — Forecasts and conditions"
