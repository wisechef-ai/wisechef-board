# CI/CD Deployment Setup

## Overview
Automated deployment pipeline that deploys wisechef-board to all client VPSes on every push to `main`.

## Architecture
- **Trigger:** Push to `main` branch or manual workflow dispatch
- **Strategy:** Matrix deployment (parallel deploy to all clients)
- **Rollback:** Automatic rollback on build/service failure
- **Backups:** Last 3 builds kept in `.backups/` on each VPS

## Client VPS List
| Client | IP | SSH Key | Hostname |
|--------|-----|---------|----------|
| michal | 89.167.67.11 | `SSH_KEY_MICHAL` | michal.wisechef.ai |
| olek | 89.167.83.118 | `SSH_KEY_OLEK` | olek.wisechef.ai |
| eryk | 46.225.125.218 | `SSH_KEY_ERYK` | eryk.wisechef.ai |

## GitHub Secrets Required
Set the following secrets in the `wisechef-ai/wisechef-board` repository:

### SSH Private Keys
1. **SSH_KEY_MICHAL**
   - Source: `~/clawd/wisechef/clients/michal/ssh_key`
   - Format: Raw private key (including `-----BEGIN OPENSSH PRIVATE KEY-----` header)

2. **SSH_KEY_OLEK**
   - Source: `~/clawd/wisechef/clients/olek/ssh_key`

3. **SSH_KEY_ERYK**
   - Source: `~/clawd/wisechef/credentials/wisechef-provisioner-pem`

## Setup Instructions

### 1. Add SSH Keys to GitHub Secrets
```bash
# From HQ server (wisechef-hq)

# Michal
gh secret set SSH_KEY_MICHAL -R wisechef-ai/wisechef-board < ~/clawd/wisechef/clients/michal/ssh_key

# Olek
gh secret set SSH_KEY_OLEK -R wisechef-ai/wisechef-board < ~/clawd/wisechef/clients/olek/ssh_key

# Eryk
gh secret set SSH_KEY_ERYK -R wisechef-ai/wisechef-board < ~/clawd/wisechef/credentials/wisechef-provisioner-pem
```

### 2. Verify GitHub CLI Authentication
```bash
gh auth status
```

If not authenticated:
```bash
gh auth login
```

### 3. Test Deployment
Trigger a manual workflow run:
```bash
gh workflow run deploy.yml -R wisechef-ai/wisechef-board
```

Monitor the run:
```bash
gh run list -R wisechef-ai/wisechef-board
gh run view <run-id> -R wisechef-ai/wisechef-board
```

## Deployment Process

### Per-Client Steps
1. **Backup current build** — `dist/` moved to `.backups/dist_backup_YYYYMMDD_HHMMSS`
2. **Pull latest code** — `git fetch origin main && git reset --hard origin/main`
3. **Install dependencies** — `npm install --production`
4. **Build frontend** — `npm run build`
5. **Restart service** — `systemctl restart wisechef-board`
6. **Health check** — Verify service is active
7. **Cleanup backup** — Remove backup on success

### Rollback on Failure
If build or service restart fails:
1. Restore previous `dist/` from backup
2. Restart service with old build
3. Exit with error (prevents marking deploy as successful)

### Backup Retention
- Last 3 builds kept in `.backups/` on each VPS
- Older backups automatically deleted

## Manual Rollback
If deployment succeeds but introduces a bug:

```bash
# SSH into affected VPS
ssh -i <key> root@<ip>

cd /opt/wisechef/board

# List available backups
ls -lt .backups/

# Restore a specific backup
mv dist dist_broken
mv .backups/dist_backup_YYYYMMDD_HHMMSS dist

# Restart service
systemctl restart wisechef-board
```

## Monitoring

### Check Deployment Status
- GitHub Actions UI: https://github.com/wisechef-ai/wisechef-board/actions
- CLI: `gh run list -R wisechef-ai/wisechef-board`

### Verify Client VPS Status
```bash
# From HQ
ssh -i ~/clawd/wisechef/clients/michal/ssh_key root@89.167.67.11 'systemctl status wisechef-board'
ssh -i ~/clawd/wisechef/clients/olek/ssh_key root@89.167.83.118 'systemctl status wisechef-board'
ssh -i ~/clawd/wisechef/credentials/wisechef-provisioner-pem root@46.225.125.218 'systemctl status wisechef-board'
```

### Check Board Version
```bash
ssh -i <key> root@<ip> 'cat /opt/wisechef/board/package.json | grep version'
```

## Troubleshooting

### Deployment Fails on One Client
- Check GitHub Actions logs for the specific client job
- Other clients continue deploying (fail-fast: false)
- SSH into failed VPS and check:
  - `journalctl -u wisechef-board -n 50` — Service logs
  - `/opt/wisechef/board/.backups/` — Verify backup was created
  - `systemctl status wisechef-board` — Service status

### Service Won't Start After Deploy
- Automatic rollback should have restored previous build
- If not, manually restore backup (see Manual Rollback above)
- Check for port conflicts: `lsof -i :3000`

### SSH Key Permission Denied
- Verify secret is set correctly: `gh secret list -R wisechef-ai/wisechef-board`
- Ensure private key format is correct (include header/footer)
- Test SSH manually from GitHub Actions runner environment

### Build Succeeds but Service Returns 500
- Check application logs: `journalctl -u wisechef-board -n 100`
- Verify `.env` file on VPS: `cat /opt/wisechef/board/.env`
- Check OpenClaw gateway status: `ssh <vps> 'systemctl status openclaw-gateway'`

## Future Enhancements
- [ ] Add Slack/Discord notification on deployment success/failure
- [ ] Deploy to fleet dashboard automatically when `WISECHEF_HQ=true`
- [ ] Add smoke tests (API health checks) before marking deploy as successful
- [ ] Implement canary deployments (deploy to 1 client, verify, then others)
- [ ] Add deployment metrics (duration, success rate, rollback frequency)
- [ ] Create staging environment for pre-production testing

## Security Notes
- SSH private keys are stored as GitHub Secrets (encrypted at rest)
- Keys are never logged or exposed in workflow output
- Each client has isolated SSH key (key compromise = 1 client affected)
- `StrictHostKeyChecking=no` used after `ssh-keyscan` (safe for CI environment)

## Support
- GitHub Actions logs: https://github.com/wisechef-ai/wisechef-board/actions
- HQ fleet dashboard: https://<hq>.wisechef.ai/fleet
- Engineer: @WiseChef-engineer in Discord #wc-dev-log
