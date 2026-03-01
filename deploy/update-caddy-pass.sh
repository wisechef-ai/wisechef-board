#!/bin/bash
# Update Caddy basic auth password for a WiseChef client
# Runs ON the client VPS. Requires: CLIENT_USER, NEW_PASS
set -euo pipefail

: "${CLIENT_USER:?Required: CLIENT_USER}"
: "${NEW_PASS:?Required: NEW_PASS}"

PASS_HASH=$(caddy hash-password --plaintext "$NEW_PASS")

# Replace the password hash line for the given user
sed -i "s|${CLIENT_USER} \$2[aby]\$.*|${CLIENT_USER} ${PASS_HASH}|" /etc/caddy/Caddyfile

caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy

echo "✅ Password updated for ${CLIENT_USER}"
