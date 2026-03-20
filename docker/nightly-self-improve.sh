#!/bin/bash
set -euo pipefail

LOG_DIR="${WISECHEF_SELF_IMPROVE_LOG_DIR:-/opt/wisechef/logs/self-improve}"
WORKSPACE_ROOT="${WORKSPACE_DIR:-/opt/wisechef/workspace}"
BOARD_URL="${BOARD_URL:-http://127.0.0.1:3333}"
COGNEE_HOME="${COGNEE_HOME:-/opt/wisechef/cognee}"
AUTORESEARCH_SCRIPT="/opt/wisechef/board/scripts/autoresearch.sh"
COGNEE_SYNC_SCRIPT="$COGNEE_HOME/nightly-sync.sh"

mkdir -p "$LOG_DIR"
exec >> "$LOG_DIR/nightly.log" 2>&1

echo "[$(date -Iseconds)] nightly self-improvement start"

if [ "${WISECHEF_SELF_IMPROVE_ENABLED:-true}" != "true" ]; then
  echo "self-improve disabled"
  exit 0
fi

if [ ! -x "$AUTORESEARCH_SCRIPT" ]; then
  echo "missing autoresearch script at $AUTORESEARCH_SCRIPT"
  exit 0
fi

# Install Cognee lazily on first run to keep image boot simpler.
if [ "${WISECHEF_COGNEE_ENABLED:-true}" = "true" ] && [ ! -x "$COGNEE_HOME/venv/bin/python" ]; then
  echo "installing cognee-lite"
  OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}" COGNEE_HOME="$COGNEE_HOME" /opt/wisechef/board/docker/cognee/install.sh || echo "cognee install failed"
fi

run_for_workspace() {
  local ws="$1"
  [ -d "$ws" ] || return 0
  [ -f "$ws/SOUL.md" ] || return 0
  echo "-- workspace: $ws"
  WORKSPACE="$ws" BOARD_URL="$BOARD_URL" OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}" bash "$AUTORESEARCH_SCRIPT" || echo "autoresearch failed for $ws"
  if [ "${WISECHEF_COGNEE_ENABLED:-true}" = "true" ] && [ -x "$COGNEE_SYNC_SCRIPT" ]; then
    WORKSPACE="$ws" COGNEE_HOME="$COGNEE_HOME" bash "$COGNEE_SYNC_SCRIPT" || echo "cognee sync failed for $ws"
  fi
}

run_for_workspace "$WORKSPACE_ROOT"
if [ -d "$WORKSPACE_ROOT/companies" ]; then
  while IFS= read -r -d '' ws; do
    run_for_workspace "$ws"
  done < <(find "$WORKSPACE_ROOT/companies" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z)
fi

echo "[$(date -Iseconds)] nightly self-improvement complete"
