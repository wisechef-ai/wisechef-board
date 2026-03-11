# WiseChef Release Notes — v2026.3.11-release10

## Release Summary

Production release addressing all 7 critical issues found during E2E testing.

**Image**: `wisechef/agent:v2026.3.11-release10` (6.91GB)
**Tagged**: `:latest`
**Date**: 2026-03-11
**Rollback**: `wisechef/agent:v2026.3.10-release3` (4.74GB)

## What Changed

### Phase 1 — Core Agent Functionality

| Issue | Fix | Commit |
|-------|-----|--------|
| #5 Chef not responding (Signal) | `dmPolicy: allowlist` → `pairing` in channels.js | `75b4989` |
| #4 No chat in dashboard | Chat controller + nav item + routes wired | `75b4989` |
| #6 Tasks not picked up | Heartbeat every 5m polls task queue | `be01ab7` |

### Phase 2 — Onboarding UX

| Issue | Fix | Commit |
|-------|-----|--------|
| #1 Multi-select + CEO role | Single-select, CEO → Strategic Advisor, "★ Recommended" badge | `199dc84` |
| #2 Redirect after onboarding | Fallback `/` → `/dashboard` | `199dc84` |
| #3 No nav between panels | "← Dashboard" topbar in enterprise panel | `4aea14d` |

### Additional Fixes

| Fix | Commit |
|-----|--------|
| Battery widget missing (`/api/usage-limits` not wired) | `40997eb` |
| Default model corrected (`claude-sonnet-4-6`, not `4.6`) | `b32df00` |
| `thinkingDefault: "low"` added to agent config | `40997eb` |
| `chatCompletions` HTTP endpoint enabled in gateway | `75b4989` |
| Enhanced SOUL.md template with task system instructions | `b412316` |
| Gateway port cleanup (`fuser -k 18789/tcp`) before start | `75b4989` |

## Git Commits (chronological)

```
75b4989 Phase 1: Core agent functionality
b412316 Phase 1 continued: heartbeat task polling + enhanced SOUL.md
be01ab7 fix: move heartbeat config to agents.defaults.heartbeat
40997eb fix: wire /api/usage-limits route + thinkingDefault
b32df00 fix: correct model name (claude-sonnet-4-6)
199dc84 Phase 2: Onboarding UX improvements
```

## Repos Status

| Repo | Branch | Status |
|------|--------|--------|
| wisechef-board | main | All changes pushed ✅ |
| wisechef-ops | main | No changes needed ✅ |
| wisechef-signup | main | No changes needed ✅ |

## Configuration (per container)

```json
{
  "gateway.http.endpoints.chatCompletions.enabled": true,
  "agents.defaults.model.primary": "openrouter/anthropic/claude-sonnet-4-6",
  "agents.defaults.thinkingDefault": "low",
  "agents.defaults.heartbeat.every": "5m",
  "agents.defaults.heartbeat.target": "none",
  "channels.signal.dmPolicy": "pairing"
}
```

## Roles (3 templates)

- 🤝 **Personal Assistant** ★ Recommended — Friendly, calm, proactive
- 🧭 **Strategic Advisor** — Big-picture thinking, prioritizes strategy
- 🔥 **Ruthless Mentor** — Brutally honest, stress-tests ideas

## Known Limitations

- Docker image at 6.91GB (commit layering) — proper Dockerfile needed
- Agent click in enterprise panel routes to `/enterprise/agents/:id` (Paperclip internal, needs source rebuild)
- No welcome message sent on Signal link (agent responds only when messaged)
- Heartbeat timing dependent on gateway uptime (~5 min granularity)
