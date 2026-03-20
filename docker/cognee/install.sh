#!/bin/bash
# cognee-lite install script for WiseChef containers
# Installs Cognee with local backends (SQLite + LanceDB + Kuzu)
# Uses OpenRouter for LLM/embedding calls
set -euo pipefail

COGNEE_HOME="${COGNEE_HOME:-/opt/wisechef/cognee}"
VENV_DIR="$COGNEE_HOME/venv"
DATA_DIR="$COGNEE_HOME/data"
LOG_DIR="$COGNEE_HOME/logs"
CONFIG_DIR="$COGNEE_HOME/config"

echo "📦 Installing Cognee-Lite at $COGNEE_HOME"

# Create directories
mkdir -p "$COGNEE_HOME" "$DATA_DIR" "$LOG_DIR" "$CONFIG_DIR"

# Create Python venv
if [ ! -d "$VENV_DIR" ]; then
  echo "🐍 Creating Python venv..."
  python3 -m venv "$VENV_DIR"
fi

# Install Cognee
echo "📎 Installing cognee..."
"$VENV_DIR/bin/pip" install --upgrade pip -q
"$VENV_DIR/bin/pip" install "cognee==0.5.5" -q

# Create .env from template if not exists
if [ ! -f "$COGNEE_HOME/.env" ]; then
  if [ -f "$CONFIG_DIR/config.env" ]; then
    cp "$CONFIG_DIR/config.env" "$COGNEE_HOME/.env"
    echo "📝 Copied config.env to .env"
  else
    cat > "$COGNEE_HOME/.env" <<ENV
# Cognee-Lite Configuration
# Uses OpenRouter for LLM and embedding calls
OPENAI_API_KEY=${OPENROUTER_API_KEY:-}
OPENAI_API_BASE=https://openrouter.ai/api/v1
LLM_MODEL=openai/gpt-4o
EMBEDDING_MODEL=openai/text-embedding-3-small
COGNEE_DB_PATH=/opt/wisechef/cognee/data/cognee.db
COGNEE_VECTOR_DB_PATH=/opt/wisechef/cognee/data/lancedb
COGNEE_GRAPH_DB_PATH=/opt/wisechef/cognee/data/kuzu
ENV
    echo "📝 Created default .env (edit with your OpenRouter key)"
  fi
fi

# Install MCP server wrapper
cp "$(dirname "$0")/cognee-mcp-server.py" "$COGNEE_HOME/cognee-mcp-server.py" 2>/dev/null || true

# Install nightly sync script
cp "$(dirname "$0")/nightly-sync.sh" "$COGNEE_HOME/nightly-sync.sh" 2>/dev/null || true
chmod +x "$COGNEE_HOME/nightly-sync.sh" 2>/dev/null || true

# Add cron for nightly sync
if command -v crontab &>/dev/null; then
  # Non-fatal: cron may not be writable in some container contexts
  (crontab -l 2>/dev/null; echo "0 3 * * * $COGNEE_HOME/nightly-sync.sh >> $LOG_DIR/sync.log 2>&1") | sort -u | crontab - || true
  echo "⏰ Nightly sync cron installed (3 AM)"
fi

echo ""
echo "✅ Cognee-Lite installed successfully!"
echo "   Home: $COGNEE_HOME"
echo "   Venv: $VENV_DIR"
echo "   Data: $DATA_DIR"
echo ""
echo "Next steps:"
echo "  1. Edit $COGNEE_HOME/.env with your OpenRouter API key"
echo "  2. Run: $COGNEE_HOME/venv/bin/python $COGNEE_HOME/cognee-mcp-server.py"
echo "  3. Add MCP server to OpenClaw config (see setup-openclaw.sh)"
