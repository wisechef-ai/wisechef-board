# syntax=docker/dockerfile:1
FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    python3 \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install OpenClaw globally
RUN npm install -g openclaw@latest

# Brand WhatsApp device name as "Chef" instead of "openclaw"
RUN find /usr/local/lib/node_modules/openclaw/dist/ -name "session-*.js" \
    -exec sed -i 's/"openclaw","cli"/"Chef","web"/g' {} \;

# Create workspace
WORKDIR /opt/wisechef

# Clone wisechef-board
RUN git clone https://github.com/wisechef-ai/wisechef-board.git board

# Install board dependencies and build
WORKDIR /opt/wisechef/board
RUN npm install --production=false && \
    npm run build && \
    npm prune --production

# Create workspace directory for agent
RUN mkdir -p /opt/wisechef/workspace

# Environment variables (overrideable at runtime)
ENV PORT=3333 \
    GATEWAY_TOKEN="" \
    WORKSPACE_DIR=/opt/wisechef/workspace \
    HOST=0.0.0.0 \
    ANTHROPIC_API_KEY="" \
    CLIENT_NAME="" \
    CLIENT_PHONE="" \
    PRIMARY_CHANNEL=""

# Expose ports
# 18789: OpenClaw gateway (internal only, not published)
# 3333: WiseChef Board (HTTP, exposed to cloudflared)
EXPOSE 18789 3333

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
