#!/bin/bash
# docker-manage.sh — Manage WiseChef client containers on the Docker host
# Usage: docker-manage.sh <action> <client-slug>
# Actions: status, restart, logs, stop, update

set -e

ACTION="${1:?Usage: docker-manage.sh <status|restart|logs|stop|update> <client-slug>}"
SLUG="${2:?Missing client slug}"
CONTAINER="wisechef-${SLUG}"

source ~/clawd/wisechef/credentials/docker-host.env
SSH_KEY=~/clawd/wisechef/credentials/wisechef-provisioner-pem
SSH_CMD="ssh -o StrictHostKeyChecking=no -i $SSH_KEY root@$DOCKER_HOST_IP"

case "$ACTION" in
  status)
    $SSH_CMD "docker inspect --format '{{.State.Status}} (started {{.State.StartedAt}})' $CONTAINER 2>/dev/null || echo 'Container not found'"
    ;;
  restart)
    $SSH_CMD "docker restart $CONTAINER"
    echo "✅ Restarted $CONTAINER"
    ;;
  logs)
    $SSH_CMD "docker logs --tail 100 -f $CONTAINER"
    ;;
  stop)
    $SSH_CMD "docker stop $CONTAINER"
    echo "✅ Stopped $CONTAINER"
    ;;
  update)
    echo "Pulling latest image..."
    $SSH_CMD "docker pull wisechef/agent:latest"
    
    echo "Reading container config..."
    ENV_ARGS=$($SSH_CMD "docker inspect --format '{{range .Config.Env}}-e {{.}} {{end}}' $CONTAINER")
    VOLUME_ARGS=$($SSH_CMD "docker inspect --format '{{range .Mounts}}-v {{.Source}}:{{.Destination}} {{end}}' $CONTAINER")
    PORT_BINDING=$($SSH_CMD "docker port $CONTAINER 3333" | grep -oP ':\K\d+')
    
    echo "Stopping and removing old container..."
    $SSH_CMD "docker stop $CONTAINER && docker rm $CONTAINER"
    
    echo "Starting updated container..."
    $SSH_CMD "docker run -d --name $CONTAINER --restart unless-stopped --memory 2g --memory-swap 3g $VOLUME_ARGS $ENV_ARGS -p ${PORT_BINDING}:3333 wisechef/agent:latest"
    echo "✅ Updated $CONTAINER"
    ;;
  *)
    echo "Unknown action: $ACTION"
    echo "Usage: docker-manage.sh <status|restart|logs|stop|update> <client-slug>"
    exit 1
    ;;
esac
