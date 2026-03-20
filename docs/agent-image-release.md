# WiseChef agent image release notes

This image is now built from pinned source inputs instead of floating clones/bundles.

## Required Docker build args
- `GH_TOKEN`
- `WISECHEF_BOARD_SHA`
- `WISECHEF_ENTERPRISE_SHA`
- `WISECHEF_ENTERPRISE_PANEL_SHA`

Optional refs/repositories have defaults in `docker/Dockerfile`.

## Nightly self-improvement
Enabled by default in WiseChef images.

Relevant env vars:
- `WISECHEF_SELF_IMPROVE_ENABLED=true|false`
- `WISECHEF_SELF_IMPROVE_CRON` (default `17 2 * * *`)
- `WISECHEF_COGNEE_ENABLED=true|false`
- `OPENROUTER_API_KEY`

The nightly job runs AutoResearch against the main workspace and each company workspace, then runs Cognee sync on recent memory files.

## 5-agent dev polygon
Use the same runtime with:
- one PA (`main`)
- four company agents (`company-*`)
- direct OpenClaw channel linking
- Paperclip or chat as the active UI surface
