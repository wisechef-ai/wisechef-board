# Changelog
## 2026.02.23

### Changed
- Adopted CalVer versioning (`YYYY.MM.DD`) matching OpenClaw's format

### Added
- `scripts/gateway-post-start.sh` — auto-approves pending device repair requests after gateway restarts. Prevents CLI lockout (`pairing required` error) without manual intervention. Tested on live VPS against all three cases: no pending devices, missing token, and real repair scenario.

### Notes
- The gateway-post-start.sh script must be wired into the **openclaw-gateway** systemd unit via `ExecStartPost`, not the board service. See deploy/setup-remote-v2.sh for integration point.
- CalVer patch releases use suffix: `2026.02.23-2`, `2026.02.23-3` etc.

