#!/bin/bash
# WiseChef Container Update Script
# Updates a running container to latest image while preserving state
# Usage: ./update-container.sh <container-name>

set -e

CONTAINER="$1"
if [ -z "$CONTAINER" ]; then
    echo "Usage: $0 <container-name>"
    exit 1
fi

echo "🔄 Updating container: $CONTAINER"

# 1. Capture current container config
echo "📋 Capturing container state..."
INSPECT=$(docker inspect "$CONTAINER")
ENV_ARGS=$(echo "$INSPECT" | python3 -c "
import json,sys
data=json.load(sys.stdin)[0]
for e in data['Config']['Env']:
    # Skip internal Docker env vars
    if e.startswith('PATH=') or e.startswith('NODE_') or e.startswith('YARN_'): continue
    if '=' in e:
        k,v = e.split('=',1)
        print(f'-e {k}=\"{v}\"')
" 2>/dev/null || echo "")

NETWORK=$(echo "$INSPECT" | python3 -c "
import json,sys
data=json.load(sys.stdin)[0]
nets=list(data['NetworkSettings']['Networks'].keys())
print(nets[0] if nets else 'bridge')
")

IMAGE=$(echo "$INSPECT" | python3 -c "
import json,sys; print(json.load(sys.stdin)[0]['Config']['Image'])
")

RESTART=$(echo "$INSPECT" | python3 -c "
import json,sys; print(json.load(sys.stdin)[0]['HostConfig']['RestartPolicy']['Name'])
")

echo "  Network: $NETWORK"
echo "  Image: $IMAGE"
echo "  Restart: $RESTART"

# 2. Backup persistent data from container
BACKUP_DIR="/tmp/wisechef-backup-${CONTAINER}"
rm -rf "$BACKUP_DIR"
mkdir -p "$BACKUP_DIR"

echo "💾 Backing up persistent data..."
# Backup openclaw config dir
docker cp "$CONTAINER:/root/.openclaw" "$BACKUP_DIR/openclaw" 2>/dev/null || true
# Backup workspace (SOUL.md, MEMORY.md, skills, etc.)
docker cp "$CONTAINER:/opt/wisechef/workspace" "$BACKUP_DIR/workspace" 2>/dev/null || true
# Backup board .env
docker cp "$CONTAINER:/opt/wisechef/board/.env" "$BACKUP_DIR/board.env" 2>/dev/null || true

echo "  Backed up to: $BACKUP_DIR"
ls -la "$BACKUP_DIR/"

# 3. Stop and remove old container
echo "🛑 Stopping old container..."
docker stop "$CONTAINER" --time 10
docker rm "$CONTAINER"

# 4. Start new container with same config
echo "🚀 Starting new container..."
eval docker run -d \
    --name "$CONTAINER" \
    --network "$NETWORK" \
    --restart "${RESTART:-unless-stopped}" \
    $ENV_ARGS \
    "$IMAGE"

# 5. Wait for container to initialize
echo "⏳ Waiting for container to initialize..."
sleep 5

# 6. Restore persistent data
echo "📥 Restoring persistent data..."
# Restore openclaw config (overwrite the fresh one)
if [ -d "$BACKUP_DIR/openclaw" ]; then
    docker cp "$BACKUP_DIR/openclaw/." "$CONTAINER:/root/.openclaw/"
fi
# Restore workspace files
if [ -d "$BACKUP_DIR/workspace" ]; then
    docker cp "$BACKUP_DIR/workspace/." "$CONTAINER:/opt/wisechef/workspace/"
fi

# 7. Restart to pick up restored config
echo "🔄 Restarting with restored config..."
docker restart "$CONTAINER"
sleep 8

# 8. Verify
echo "✅ Verifying..."
docker exec "$CONTAINER" cat /root/.openclaw/openclaw.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'  Model: {d[\"agents\"][\"defaults\"][\"model\"]}')" 2>/dev/null || echo "  (could not read config)"
docker exec "$CONTAINER" ls /opt/wisechef/workspace/ 2>/dev/null | head -5
STATUS=$(docker inspect "$CONTAINER" --format '{{.State.Status}}')
echo "  Container status: $STATUS"

# 9. Cleanup
rm -rf "$BACKUP_DIR"
echo "🎉 Update complete for $CONTAINER"
