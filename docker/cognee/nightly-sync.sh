#!/bin/bash
# Nightly Cognee sync — ingests recent memory files and runs cognify
set -euo pipefail

COGNEE_HOME="${COGNEE_HOME:-/opt/wisechef/cognee}"
WORKSPACE="${WORKSPACE:-/opt/wisechef/clawd}"
VENV="$COGNEE_HOME/venv/bin/python"
LOG_DIR="$COGNEE_HOME/logs"

mkdir -p "$LOG_DIR"

echo "[$(date -Iseconds)] Starting nightly sync"

# Find memory files from last 24 hours
MEMORY_DIR="$WORKSPACE/memory"
if [ -d "$MEMORY_DIR" ]; then
  find "$MEMORY_DIR" -name "*.md" -mtime -1 | while read -r f; do
    echo "  Ingesting: $f"
    "$VENV" -c "
import asyncio, cognee
from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path('$COGNEE_HOME/.env'))

async def ingest():
    content = Path('$f').read_text(errors='replace')
    await cognee.add(content, dataset_name='memory')
    await cognee.cognify()
    print('  ✓ Ingested and cognified')

asyncio.run(ingest())
" 2>&1 || echo "  ✗ Failed to ingest $f"
  done
else
  echo "  No memory directory found at $MEMORY_DIR"
fi

echo "[$(date -Iseconds)] Nightly sync complete"
