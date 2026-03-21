# syntax=docker/dockerfile:1.6
# WiseChef Agent Container — reproducible customer runtime
# Stack: OpenClaw + WiseChef Board + Enterprise Panel + nightly self-improve/Cognee scaffolding
FROM node:22-slim

RUN apt-get update && apt-get install -y \
    cron git python3 python3-venv curl ca-certificates build-essential openssl \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g openclaw@latest

RUN find /usr/local/lib/node_modules/openclaw/dist/ -name "session-*.js" \
    -exec sed -i 's/"openclaw","cli"/"Chef","web"/g' {} \; 2>/dev/null || true

WORKDIR /opt/wisechef

# ── 1. WiseChef Board ──
ARG WISECHEF_BOARD_REPO=https://github.com/wisechef-ai/wisechef-board.git
ARG WISECHEF_BOARD_REF=release/v26.04.1
ARG WISECHEF_BOARD_SHA
RUN test -n "$WISECHEF_BOARD_SHA" || (echo "WISECHEF_BOARD_SHA build arg is required" && exit 1)
RUN git clone --branch "$WISECHEF_BOARD_REF" "$WISECHEF_BOARD_REPO" board && \
    cd board && \
    git checkout --detach "$WISECHEF_BOARD_SHA" && \
    test "$(git rev-parse HEAD)" = "$WISECHEF_BOARD_SHA"
WORKDIR /opt/wisechef/board
RUN npm install --production=false && npm run build && npm prune --production

# ── 2. WiseChef Enterprise CLI ──
WORKDIR /opt/wisechef
ARG WISECHEF_ENTERPRISE_REPO=https://github.com/wisechef-ai/wisechef-enterprise.git
ARG WISECHEF_ENTERPRISE_REF=feature/cost-controls
ARG WISECHEF_ENTERPRISE_SHA
RUN test -n "$WISECHEF_ENTERPRISE_SHA" || (echo "WISECHEF_ENTERPRISE_SHA build arg is required" && exit 1)
RUN --mount=type=secret,id=GH_TOKEN \
    bash -lc 'set -e; \
      printf "#!/bin/sh\ncat /run/secrets/GH_TOKEN\n" > /tmp/askpass && chmod +x /tmp/askpass; \
      export GIT_ASKPASS=/tmp/askpass GIT_TERMINAL_PROMPT=0; \
      git clone --branch "$WISECHEF_ENTERPRISE_REF" \
        "https://x-access-token@github.com/wisechef-ai/wisechef-enterprise.git" enterprise && \
      cd enterprise && \
      git checkout --detach "$WISECHEF_ENTERPRISE_SHA" && \
      test "$(git rev-parse HEAD)" = "$WISECHEF_ENTERPRISE_SHA" && \
      npm install --production && \
      chmod +x cli.js && \
      ln -sf /opt/wisechef/enterprise/cli.js /usr/local/bin/wisechef-enterprise && \
      git remote set-url origin "$WISECHEF_ENTERPRISE_REPO"'

# ── 3. WiseChef Enterprise Panel (built from pinned source, no opaque bundle) ──
ARG WISECHEF_ENTERPRISE_PANEL_REPO=https://github.com/wisechef-ai/wisechef-enterprise-panel.git
ARG WISECHEF_ENTERPRISE_PANEL_REF=hotfix/fix-docker-build-ts-errors
ARG WISECHEF_ENTERPRISE_PANEL_SHA
RUN test -n "$WISECHEF_ENTERPRISE_PANEL_SHA" || (echo "WISECHEF_ENTERPRISE_PANEL_SHA build arg is required" && exit 1)
RUN --mount=type=secret,id=GH_TOKEN \
    bash -lc 'set -e; \
      printf "#!/bin/sh\ncat /run/secrets/GH_TOKEN\n" > /tmp/askpass && chmod +x /tmp/askpass; \
      export GIT_ASKPASS=/tmp/askpass GIT_TERMINAL_PROMPT=0; \
      git clone --branch "$WISECHEF_ENTERPRISE_PANEL_REF" \
        "https://x-access-token@github.com/wisechef-ai/wisechef-enterprise-panel.git" enterprise-panel && \
      cd enterprise-panel && \
      git checkout --detach "$WISECHEF_ENTERPRISE_PANEL_SHA" && \
      test "$(git rev-parse HEAD)" = "$WISECHEF_ENTERPRISE_PANEL_SHA" && \
      corepack enable && \
      (pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile) && \
      pnpm -r build && \
      git remote set-url origin "$WISECHEF_ENTERPRISE_PANEL_REPO"'

# ── 4. Runtime setup ──
WORKDIR /opt/wisechef
RUN mkdir -p /opt/wisechef/workspace /opt/wisechef/data /opt/wisechef/logs/self-improve /opt/wisechef/cognee

# ── Copy bundled skills ──
COPY docker/skills /opt/wisechef/bundled-skills

ENV PORT=3333 \
    GATEWAY_TOKEN="" \
    WORKSPACE_DIR=/opt/wisechef/workspace \
    HOST=0.0.0.0 \
    OPENROUTER_API_KEY="" \
    CLIENT_NAME="" \
    CLIENT_PHONE="" \
    CLIENT_CHANNEL="" \
    WISECHEF_PLAN="contractor" \
    WISECHEF_MODEL="" \
    DATABASE_PATH=/opt/wisechef/data/enterprise.sqlite \
    PAPERCLIP_PORT=3100 \
    PAPERCLIP_AUTH_MODE=local_trusted \
    PAPERCLIP_MODE=external \
    WISECHEF_SELF_IMPROVE_ENABLED=true \
    WISECHEF_SELF_IMPROVE_CRON="17 2 * * *" \
    WISECHEF_COGNEE_ENABLED=true \
    COGNEE_HOME=/opt/wisechef/cognee \
    OPENAI_API_BASE=https://openrouter.ai/api/v1 \
    LLM_MODEL=openai/gpt-4o \
    EMBEDDING_MODEL=openai/text-embedding-3-small

COPY docker/cognee /opt/wisechef/board/docker/cognee
COPY docker/nightly-self-improve.sh /opt/wisechef/board/docker/nightly-self-improve.sh
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /opt/wisechef/board/docker/nightly-self-improve.sh /opt/wisechef/board/docker/cognee/install.sh /opt/wisechef/board/docker/cognee/nightly-sync.sh

# ── Install Scrapling (web scraping with JS rendering) ──
RUN python3 -m venv /opt/wisechef/scrapling-env && \
    /opt/wisechef/scrapling-env/bin/pip install --no-cache-dir scrapling && \
    ln -sf /opt/wisechef/scrapling-env/bin/scrapling /usr/local/bin/scrapling

# Pre-create postgres user + patch embedded-postgres for root execution
RUN groupadd -f postgres && useradd -g postgres -s /bin/false -M postgres 2>/dev/null; \
    EPANEL_INDEX="/opt/wisechef/enterprise-panel/server/dist/index.js"; \
    if [ -f "$EPANEL_INDEX" ] && grep -q 'new EmbeddedPostgres({' "$EPANEL_INDEX" && ! grep -q 'createPostgresUser' "$EPANEL_INDEX"; then \
      sed -i 's/new EmbeddedPostgres({/new EmbeddedPostgres({ createPostgresUser: true,/' "$EPANEL_INDEX"; \
    fi; \
    EP_LIB=$(find /opt/wisechef/enterprise-panel/node_modules -path '*/embedded-postgres/dist/index.js' 2>/dev/null | head -1); \
    if [ -n "$EP_LIB" ] && grep -q 'en_US.UTF-8' "$EP_LIB"; then \
      sed -i "s/const LC_MESSAGES_LOCALE = .*/const LC_MESSAGES_LOCALE = 'C';/" "$EP_LIB"; \
    fi; \
    chmod 755 /root; \
    true

EXPOSE 18789 3100 3333
ENTRYPOINT ["/entrypoint.sh"]
