# Agent Runtime Selection

WiseChef supports two agent runtimes for powering your AI assistant. You choose the runtime during the onboarding signup flow.

## Runtimes

### OpenClaw (default)

OpenClaw is the default agent runtime. It's a Node.js-based agent framework that provides:

- Local agent execution with gateway mode
- Built-in device pairing and channel management
- Paperclip integration via the task board API
- WebSocket-based real-time communication
- Proactive agent architecture (heartbeats, task pickup, WAL protocol)

**Best for:** General-purpose assistants, small-to-medium teams, customers who want the stable default.

**What gets installed:**
- `openclaw` (npm global)
- WiseChef Board (Express + React)
- Enterprise Panel (Paperclip)
- Cognee knowledge graph (optional)

### Hermes

Hermes is a Python-based agent framework by NousResearch with broader model and tool support:

- Multi-provider support (Anthropic, OpenAI, Google, etc.)
- Advanced tool ecosystem (terminal, browser, MCP, code execution)
- Rich terminal UI (Ink-based TUI)
- Multi-platform messaging gateway (Telegram, Discord, Slack, WhatsApp, Signal)
- Prompt caching and context compression
- Skill system with hub marketplace

**Best for:** Power users, teams needing multi-platform messaging, customers who want the latest agent capabilities.

**What gets installed:**
- `openclaw` (npm global, for gateway compatibility)
- `hermes-paperclip-adapter` (npm global, bridges Hermes ↔ Paperclip)
- WiseChef Board (Express + React)
- Enterprise Panel (Paperclip)
- Cognee knowledge graph (optional)

## How It Works

### During Signup

1. The signup form presents a runtime selector (default: OpenClaw)
2. Your choice is saved in `onboarding-complete.json`
3. The runtime is passed to the provisioning system

### During Provisioning

1. The Dockerfile builds with `WISECHEF_RUNTIME=openclaw|hermes`
2. When `hermes`, it installs `hermes-paperclip-adapter` alongside OpenClaw
3. The container entrypoint detects the runtime and configures accordingly:
   - **OpenClaw:** Creates `openclaw.json`, starts OpenClaw gateway, syncs agents
   - **Hermes:** Creates `~/.hermes/config.yaml`, starts `hermes-paperclip-adapter`, skips OpenClaw sync

### Runtime Detection

The runtime is determined by:

1. `WISECHEF_RUNTIME` environment variable (primary)
2. `runtime` field in onboarding payload (set during signup)
3. Falls back to `openclaw` if not specified

### Health Monitoring

- **OpenClaw:** Watchdog pings `http://127.0.0.1:18789/health`
- **Hermes:** Watchdog checks `hermes-paperclip-adapter` process via `pgrep`

Both runtimes share the same WiseChef Board (port 3333) and Enterprise Panel (port 3100).

## Switching Runtimes

To switch an existing deployment from OpenClaw to Hermes (or vice versa):

1. Set `WISECHEF_RUNTIME=hermes` in the container environment
2. Rebuild/restart the container
3. The entrypoint will reconfigure for the new runtime

Note: Runtime switching resets agent configuration. Existing SOUL.md and MEMORY.md are preserved.

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/onboarding/tier` | Returns available runtimes for the current plan |
| `POST /api/onboarding/one-shot` | Accepts `runtime` in body (starter/pro) |
| `POST /api/onboarding/unified` | Accepts `runtime` in body (enterprise) |

Valid runtime values: `openclaw`, `hermes`.
