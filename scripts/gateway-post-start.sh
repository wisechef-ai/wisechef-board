#!/usr/bin/env bash
# gateway-post-start.sh — Auto-approve pending loopback device repair requests
#
# PURPOSE: After the openclaw-gateway service restarts, the CLI device pairing
# state can be invalidated, queuing a repair request that blocks all CLI commands.
# This script auto-approves any pending repair request using --latest.
#
# USAGE: Run as ExecStartPost in the openclaw-gateway.service unit (not the board).
#   ExecStartPost=-/path/to/gateway-post-start.sh
#
# REQUIREMENTS:
#   - OPENCLAW_GATEWAY_TOKEN must be set in the gateway service environment
#   - openclaw CLI must be on PATH
#
# NOTE: The - prefix on ExecStartPost means systemd won't fail the service if
# this script exits non-zero. Failures are logged but non-fatal.

set -euo pipefail

LOG_TAG="gateway-post-start"
MAX_WAIT=20   # seconds to wait for gateway to be ready
INTERVAL=2    # poll interval in seconds

log() { echo "[${LOG_TAG}] $*" | systemd-cat -t openclaw-gateway -p info 2>/dev/null || echo "[${LOG_TAG}] $*" >&2; }
log_warn() { echo "[${LOG_TAG}] WARN: $*" | systemd-cat -t openclaw-gateway -p warning 2>/dev/null || echo "[${LOG_TAG}] WARN: $*" >&2; }

# Wait for the gateway HTTP port to accept connections (fast check, no CLI auth needed)
wait_for_gateway() {
  local port="${OPENCLAW_GATEWAY_PORT:-18789}"
  local elapsed=0
  log "Waiting for gateway on port ${port}..."
  while [[ ${elapsed} -lt ${MAX_WAIT} ]]; do
    if curl -sf "http://127.0.0.1:${port}/" -o /dev/null 2>/dev/null; then
      log "Gateway ready after ${elapsed}s"
      return 0
    fi
    sleep "${INTERVAL}"
    elapsed=$(( elapsed + INTERVAL ))
  done
  log_warn "Gateway did not respond on port ${port} after ${MAX_WAIT}s — skipping auto-approve"
  return 1
}

# Check for pending requests and approve using --latest (no output parsing needed)
approve_pending() {
  local output
  # --latest exits 1 with "No pending device pairing requests" when nothing queued
  output=$(openclaw devices approve --latest --json 2>&1 || true)
  if echo "${output}" | grep -q '"approved"'; then
    log "Pending repair request auto-approved"
  elif echo "${output}" | grep -qi "no pending"; then
    log "No pending repair requests — already paired"
  else
    log_warn "Unexpected approve output: ${output}"
  fi
}

main() {
  if [[ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]]; then
    log_warn "OPENCLAW_GATEWAY_TOKEN not set — cannot auto-approve devices"
    exit 0  # non-fatal: let the gateway run normally
  fi

  wait_for_gateway || exit 0  # non-fatal if gateway slow to start

  approve_pending
  log "Done"
}

main "$@"
