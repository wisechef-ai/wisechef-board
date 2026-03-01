#!/bin/bash
# WiseChef DNS Setup — Creates A record for client subdomain on Hetzner DNS
# Runs LOCALLY. Requires: HETZNER_DNS_TOKEN, CLIENT_ID, CLIENT_IP
set -euo pipefail

: "${HETZNER_DNS_TOKEN:?Required: HETZNER_DNS_TOKEN (from dns.hetzner.com)}"
: "${CLIENT_ID:?Required: CLIENT_ID}"
: "${CLIENT_IP:?Required: CLIENT_IP}"

ZONE_NAME="wisechef.ai"
API="https://dns.hetzner.com/api/v1"
AUTH="Auth-API-Token: $HETZNER_DNS_TOKEN"

echo "🌐 Setting up DNS for ${CLIENT_ID}.${ZONE_NAME} → ${CLIENT_IP}"

# 1. Find zone ID
ZONE_ID=$(curl -s "$API/zones" -H "$AUTH" | jq -r ".zones[] | select(.name==\"$ZONE_NAME\") | .id")

if [ -z "$ZONE_ID" ] || [ "$ZONE_ID" = "null" ]; then
    echo "   Zone $ZONE_NAME not found. Creating..."
    ZONE_ID=$(curl -s -X POST "$API/zones" \
        -H "$AUTH" -H "Content-Type: application/json" \
        -d "{\"name\":\"$ZONE_NAME\",\"ttl\":3600}" | jq -r '.zone.id')
    echo "   ✅ Zone created: $ZONE_ID"
else
    echo "   ✅ Zone found: $ZONE_ID"
fi

# 2. Check if A record already exists
EXISTING=$(curl -s "$API/records?zone_id=$ZONE_ID" -H "$AUTH" | \
    jq -r ".records[] | select(.name==\"$CLIENT_ID\" and .type==\"A\") | .id")

if [ -n "$EXISTING" ]; then
    echo "   Updating existing A record ($EXISTING)..."
    curl -s -X PUT "$API/records/$EXISTING" \
        -H "$AUTH" -H "Content-Type: application/json" \
        -d "{\"value\":\"$CLIENT_IP\",\"ttl\":300,\"type\":\"A\",\"name\":\"$CLIENT_ID\",\"zone_id\":\"$ZONE_ID\"}" | jq -r '.record.id' >/dev/null
    echo "   ✅ Updated: ${CLIENT_ID}.${ZONE_NAME} → ${CLIENT_IP}"
else
    echo "   Creating A record..."
    curl -s -X POST "$API/records" \
        -H "$AUTH" -H "Content-Type: application/json" \
        -d "{\"value\":\"$CLIENT_IP\",\"ttl\":300,\"type\":\"A\",\"name\":\"$CLIENT_ID\",\"zone_id\":\"$ZONE_ID\"}" | jq -r '.record.id' >/dev/null
    echo "   ✅ Created: ${CLIENT_ID}.${ZONE_NAME} → ${CLIENT_IP}"
fi

echo "   DNS may take up to 5 minutes to propagate."
