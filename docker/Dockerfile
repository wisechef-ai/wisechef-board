# syntax=docker/dockerfile:1
# WiseChef Agent Container — v2026.3.10
# Full stack: OpenClaw + WiseChef Board + Enterprise Panel (SQLite) + Enterprise CLI
FROM node:22-slim

# System deps
RUN apt-get update && apt-get install -y \
    git python3 curl ca-certificates build-essential openssl \
    && rm -rf /var/lib/apt/lists/*

# Install OpenClaw globally
RUN npm install -g openclaw@latest

# Brand WhatsApp device name
RUN find /usr/local/lib/node_modules/openclaw/dist/ -name "session-*.js" \
    -exec sed -i 's/"openclaw","cli"/"Chef","web"/g' {} \; 2>/dev/null || true

WORKDIR /opt/wisechef

# ── 1. WiseChef Board ──
RUN git clone --depth 1 https://github.com/wisechef-ai/wisechef-board.git board

WORKDIR /opt/wisechef/board
RUN npm install --production=false && \
    npm run build && \
    npm prune --production

# ── 2. WiseChef Enterprise CLI (private repo) ──
ARG GH_TOKEN
WORKDIR /opt/wisechef
RUN git clone --depth 1 -b feature/enterprise-onboarding-wizard \
    https://x-access-token:${GH_TOKEN}@github.com/wisechef-ai/wisechef-enterprise.git enterprise && \
    cd enterprise && npm install --production && \
    chmod +x cli.js && \
    ln -sf /opt/wisechef/enterprise/cli.js /usr/local/bin/wisechef-enterprise && \
    # Scrub token from git remote
    cd /opt/wisechef/enterprise && git remote set-url origin https://github.com/wisechef-ai/wisechef-enterprise.git

# ── 3. Enterprise Panel (pre-built SQLite bundle) ──
COPY enterprise-panel-bundle /opt/wisechef/enterprise-panel

# ── 4. Enterprise mount override for local SQLite mode ──
COPY enterprise-mount-local.js /opt/wisechef/board/server/enterprise-mount.js

# ── 5. Final setup ──
WORKDIR /opt/wisechef
RUN mkdir -p /opt/wisechef/workspace /opt/wisechef/data

# Environment variables
ENV PORT=3333 \
    GATEWAY_TOKEN="" \
    WORKSPACE_DIR=/opt/wisechef/workspace \
    HOST=0.0.0.0 \
    OPENROUTER_API_KEY="" \
    CLIENT_NAME="" \
    CLIENT_PHONE="" \
    CLIENT_CHANNEL="" \
    WISECHEF_PLAN="starter" \
    WISECHEF_MODEL="" \
    DATABASE_PATH=/opt/wisechef/data/enterprise.sqlite \
    PAPERCLIP_PORT=3100 \
    PAPERCLIP_AUTH_MODE=local_trusted

EXPOSE 18789 3100 3333

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
