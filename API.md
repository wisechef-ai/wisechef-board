# API Reference

All endpoints are served on `localhost:3333`.

## Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks` | List all tasks |
| POST | `/api/tasks` | Create a task |
| PUT | `/api/tasks/:id` | Update a task |
| DELETE | `/api/tasks/:id` | Delete a task |
| POST | `/api/tasks/:id/run` | Mark task for immediate execution |
| POST | `/api/tasks/:id/pickup` | Mark task as picked up by agent |
| POST | `/api/tasks/:id/complete` | Mark task as done with result |
| GET | `/api/tasks/queue` | Get executable task queue (sorted by priority) |

## Usage & Models

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/usage` | Usage stats with rate limit percentages |
| GET | `/api/models` | List available models (from openclaw.json) |
| POST | `/api/model` | Switch active model |

## Skills

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/skills` | List all skills with status |
| POST | `/api/skills/:id/toggle` | Enable/disable a skill |
| POST | `/api/skills/create` | Create a custom workspace skill |
| GET | `/api/skills/:id/content` | Read full SKILL.md content |
| DELETE | `/api/skills/:id` | Delete a workspace skill |

## Files

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/files?path=` | List directory contents |
| GET | `/api/files/content?path=` | Read file content |
| GET | `/api/files/download?path=` | Download a file |

## Soul & Workspace Files

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/soul` | Read SOUL.md |
| PUT | `/api/soul` | Save SOUL.md (with version history) |
| GET | `/api/soul/history` | Get SOUL.md version history |
| POST | `/api/soul/revert` | Revert to a previous version |
| GET | `/api/soul/templates` | List persona templates |
| GET | `/api/workspace-file?name=` | Read a workspace file |
| PUT | `/api/workspace-file?name=` | Save a workspace file (with history) |

## Heartbeat

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/heartbeat` | Get last heartbeat timestamp |
| POST | `/api/heartbeat` | Record a heartbeat |

## Calendar

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/calendar` | Get activity data from memory files |

## Onboarding

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/onboarding/tier` | Get detected tier, runtime, and agent limits |
| GET | `/api/onboarding/roles` | List all role templates used by onboarding |
| POST | `/api/onboarding/unified` | Run unified onboarding provisioning flow |
| POST | `/api/onboarding/one-shot` | Fast generation flow used by Starter/Pro launch |

### Runtime Selection

Both onboarding endpoints accept a `runtime` field (`"openclaw"` or `"hermes"`). The selected runtime determines which agent framework is used:

- **`openclaw`** (default): Node.js agent framework with gateway mode
- **`hermes`**: Python-based agent framework with hermes-paperclip-adapter for Paperclip integration

Example payload for `/api/onboarding/one-shot`:
```json
{
  "userInput": "...",
  "companyName": "Acme Corp",
  "runtime": "hermes",
  "language": "English"
}
```

The runtime is persisted in `onboarding-complete.json` and used by the container entrypoint to configure the appropriate services.
