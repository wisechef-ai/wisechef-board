# Option B: Per-Company OpenClaw Agents

## Architecture

**Current (broken):**
```
Paperclip Company A → Agent "CEO" → agentId: "main" → shared workspace
Paperclip Company B → Agent "CEO" → agentId: "main" → shared workspace
```

**After (isolated):**
```
Paperclip Company A → Agent "CEO" → agentId: "company-<companyId>" → /opt/wisechef/workspace/companies/<companyId>/
Paperclip Company B → Agent "CEO" → agentId: "company-<companyId>" → /opt/wisechef/workspace/companies/<companyId>/
Chef (personal)    → Agent "Chef" → agentId: "main"                → /opt/wisechef/workspace/
```

## How OpenClaw Agents Work

Each agent in `agents.list` gets:
- `id`: unique identifier (used as `agentId` in adapter config)
- `workspace`: path to the agent's workspace (SOUL.md, MEMORY.md, etc.)
- `agentDir`: path to agent data dir (sessions, etc.) — defaults to `~/.openclaw/agents/<id>/`
- `identity.name`: display name

## Changes Required

### 1. entrypoint.sh (bootstrap phase)
After bootstrapping companies and agents in Paperclip, query all companies+agents and:
- For each company: create an OpenClaw agent `company-<companyId>`
- Set `workspace` to `/opt/wisechef/workspace/companies/<companyId>/`
- Create per-company SOUL.md with company-specific context
- Claim a separate API key per company-agent pair
- Write updated `openclaw.json` with all agents listed
- Restart gateway after config write

### 2. enterprise-mount.js (proxy interceptor)
When creating/updating Paperclip agents:
- `agentId` → `company-<companyId>` (extracted from the URL path)
- NOT `main` anymore

### 3. entrypoint.sh (fix-urls phase)
Same change — set `agentId` to `company-<companyId>` per company.

### 4. API key claiming
Each company's agent gets its own Paperclip API key.
Store at `/opt/wisechef/workspace/companies/<companyId>/paperclip-api-key.json`.

## File Changes

| File | Change |
|------|--------|
| `docker/entrypoint.sh` | Add `sync-agents.js` call after Paperclip bootstrap |
| `server/enterprise-mount.js` | Interceptor: `agentId` = `company-<companyId>` based on URL |
| `docker/sync-agents.js` (NEW) | Node script: reads Paperclip companies → writes OpenClaw config → creates workspaces → claims keys |

## Test Plan

1. Fresh container boot → 1 company "Test Corp" created → OpenClaw has `main` + `company-<id>` agents
2. Create 2nd company via UI → agent points to `company-<id2>` (proxy interceptor)
3. Run task in company A → agent sees only company A's SOUL.md/workspace
4. Run task in company B → agent sees only company B's workspace
5. No cross-company file visibility

## Backward Compatibility

- `main` agent stays as the personal Chef (board dashboard)
- New companies get `company-<companyId>` agents
- Existing containers: first-boot wipe handles clean migration
