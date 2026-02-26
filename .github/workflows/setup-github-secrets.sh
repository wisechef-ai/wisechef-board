#!/usr/bin/env bash
# setup-github-secrets.sh — Add SSH keys to wisechef-board GitHub repo secrets
set -euo pipefail

REPO="wisechef-ai/wisechef-board"

# Color output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# Check gh CLI is installed and authenticated
if ! command -v gh &> /dev/null; then
  log_error "GitHub CLI (gh) not found. Install: https://cli.github.com/"
  exit 1
fi

if ! gh auth status &> /dev/null; then
  log_error "GitHub CLI not authenticated. Run: gh auth login"
  exit 1
fi

log_info "Setting up GitHub Secrets for $REPO"
echo

# SSH Key paths
MICHAL_KEY="$HOME/clawd/wisechef/clients/michal/ssh_key"
OLEK_KEY="$HOME/clawd/wisechef/clients/olek/ssh_key"
ERYK_KEY="$HOME/clawd/wisechef/credentials/wisechef-provisioner-pem"

# Verify keys exist
for key in "$MICHAL_KEY" "$OLEK_KEY" "$ERYK_KEY"; do
  if [[ ! -f "$key" ]]; then
    log_error "SSH key not found: $key"
    exit 1
  fi
done

log_info "All SSH keys found"

# Add secrets
log_info "Adding SSH_KEY_MICHAL..."
if gh secret set SSH_KEY_MICHAL -R "$REPO" < "$MICHAL_KEY"; then
  log_info "✅ SSH_KEY_MICHAL added"
else
  log_error "Failed to add SSH_KEY_MICHAL"
  exit 1
fi

log_info "Adding SSH_KEY_OLEK..."
if gh secret set SSH_KEY_OLEK -R "$REPO" < "$OLEK_KEY"; then
  log_info "✅ SSH_KEY_OLEK added"
else
  log_error "Failed to add SSH_KEY_OLEK"
  exit 1
fi

log_info "Adding SSH_KEY_ERYK..."
if gh secret set SSH_KEY_ERYK -R "$REPO" < "$ERYK_KEY"; then
  log_info "✅ SSH_KEY_ERYK added"
else
  log_error "Failed to add SSH_KEY_ERYK"
  exit 1
fi

echo
log_info "All secrets added successfully!"
log_info "Verify with: gh secret list -R $REPO"

# List secrets to confirm
echo
log_info "Current secrets:"
gh secret list -R "$REPO"
