# Pending: GitHub Actions Workflow

These workflow files need a GitHub PAT with  scope to push.

## How to push (Adam — run this once):
```bash
cd /home/wisechef/companies/wisechef/wisechef-board
# Use a PAT with: repo + workflow + write:packages scopes
GH_TOKEN=<your-pat-with-workflow-scope>
git add .github/workflows/release.yml .github/workflows/setup-release-secrets.sh
git commit -m "ci: add release workflow"
git push "https://${GH_TOKEN}@github.com/wisechef-ai/wisechef-board.git" release/v26.04.1
```

## What release.yml does:
- Triggers on: push to master
- Builds wisechef/agent:<calver-date> Docker image
- Pushes to Docker Hub (needs DOCKERHUB_USERNAME + DOCKERHUB_TOKEN secrets)
- Updates provisioning/.env on wisechef-hq with new tag
- Pulls new image on docker-01
- Sends Discord notification

## Secrets needed (run setup-release-secrets.sh):
- GH_TOKEN (repo scope — for private repo clones in Docker build)
- DOCKERHUB_USERNAME / DOCKERHUB_TOKEN (for Docker Hub push)
- WISECHEF_HQ_SSH_KEY / WISECHEF_HQ_IP (for post-build provisioning update)
- DISCORD_WEBHOOK_URL (optional, for notifications)
