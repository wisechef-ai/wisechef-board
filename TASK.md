# TASK: Unified Onboarding for WiseChef Board

## Overview
Replace the current broken multi-file onboarding with ONE unified onboarding page that adapts to customer tier (Starter/Pro/Enterprise).

## Current State
- `pages/onboarding-one-shot.html` — URL scrape + AI generation (partially working)
- `pages/onboarding.html` — 7-step wizard (unused)
- `server/routes.js` — route logic with `isOnboarded()` checks
- SPA has its own onboarding component that conflicts

## What to Build

### 1. `pages/onboarding-unified.html` (single self-contained HTML page)

A beautiful, modern, dark-themed onboarding wizard. Self-contained (inline CSS + JS, no external frameworks except optionally a CDN icon set). Must work on mobile.

#### Screen Flow by Tier:

**Starter ($49/mo) — 3 screens:**
1. **Your Business** — URL input (optional scrape) OR manual form (company name, what you do, language)  
2. **Pick Your Agent** — Grid of 18 role cards. Select exactly 1. Each card: emoji + role name + 1-line description
3. **Launching...** → loading animation → calls `/api/onboarding/one-shot` → redirects to board

**Pro ($99/mo) — 3 screens:**
1. Same as Starter screen 1
2. **Build Your Team** — Same grid but select up to 3 roles. Show counter "2/3 selected"
3. Same as Starter screen 3

**Enterprise ($499/mo) — 5 screens:**
1. **Your Company** — Company name, industry dropdown, size (1-10, 11-50, 51-200, 200+), what you do, language
2. **Build Your Team** — Same role grid but select 1-20. Roles grouped by department category. Counter "5/20 selected"
3. **Customize Agents** — For each selected role, show: display name (pre-filled), personality slider (formal↔casual), priority focus (text input)
4. **Connect Telegram** — For each selected role/department, input field for Telegram group link/ID. "We'll set up your bot in each group." Skip option.
5. **Review & Launch** — Summary of company + selected agents + channels. Big "Launch My Team" button → loading → redirect to `/dashboard`

#### Tier Detection:
- On page load, call `GET /api/onboarding/tier` which returns `{ tier: "starter"|"pro"|"enterprise", limits: { agents: 1|3|20 } }`
- If no tier detected, default to "starter" flow
- Show tier badge in top-right corner

#### Design:
- Dark theme (#0a0a0a background, white text, accent #6366f1 indigo)
- Cards: dark cards (#1a1a1a) with subtle border, hover glow effect
- Selected cards: indigo border + checkmark
- Smooth transitions between screens
- Progress indicator (dots or steps bar)
- Mobile-first, responsive
- WiseChef logo top-left

### 2. Agent Role Templates — `server/templates/roles/`

Create a directory with 18 JSON files, one per role:

```
server/templates/roles/
  ceo.json
  engineer.json
  growth.json
  devops.json
  sales.json
  support.json
  hr.json
  finance.json
  legal.json
  product.json
  design.json
  content.json
  data-analyst.json
  operations.json
  security.json
  qa.json
  community.json
  partnerships.json
```

Each file:
```json
{
  "id": "ceo",
  "name": "CEO",
  "emoji": "👔",
  "category": "Leadership",
  "shortDescription": "Strategy, delegation, oversight",
  "soulTemplate": "You are the CEO of {{company_name}}. Your role is strategic oversight...",
  "heartbeatTemplate": "Check company status, review agent outputs, delegate tasks...",
  "defaultTools": ["web_search", "message", "sessions_spawn"],
  "personality": { "formality": 0.8, "proactivity": 0.9 }
}
```

Categories for grouping in Enterprise view:
- **Leadership**: CEO, Product, Operations
- **Engineering**: Engineer, DevOps, Security, QA, Data Analyst
- **Business**: Sales, Finance, Legal, Partnerships
- **Growth**: Growth, Marketing (same as Growth alias), Content, Design, Community
- **People**: HR, Support

### 3. API Endpoints — add to `server/routes.js`

**`GET /api/onboarding/tier`**
- Check Stripe subscription for this workspace
- Return `{ tier, limits: { agents } }`
- For now, stub: check env `WISECHEF_TIER` or default to "starter"

**`POST /api/onboarding/unified`**
- Body: `{ company: { name, description, industry, size, language }, agents: [{ roleId, displayName, personality, telegramGroup? }], tier }`
- For each selected agent:
  - Generate SOUL.md from template (fill `{{company_name}}`, `{{company_description}}`, etc.)
  - Generate HEARTBEAT.md from template
  - Create agent workspace directory
  - If enterprise + telegram groups provided, store channel config
- Create `onboarding-complete.json` with all metadata
- Return `{ success: true, redirect: "/dashboard" | "/" }`

**`GET /api/onboarding/roles`**
- Returns all 18 roles from templates directory
- Used by the frontend to populate the grid

### 4. Route Logic Update — `server/routes.js`

Replace current root route:
```js
router.get('/', (req, res) => {
  if (!isOnboarded()) {
    return res.sendFile(path.join(__dirname, 'pages', 'onboarding-unified.html'));
  }
  // ... existing linked channel / SPA logic
});
```

Also update the wildcard `*` route to respect the same gate (already done, just keep it).

### 5. Delete old files
- Remove `pages/onboarding-one-shot.html`
- Remove `pages/onboarding.html`  
- Keep `pages/link-channel.html` and `pages/select-agent.html` (may still be useful)

## Technical Notes
- The server uses ES modules (`import`/`export`)
- `__dirname` is the project root (set in `server/config.js` as `ROOT_DIR`)
- `WORKSPACE` is `process.env.WORKSPACE_DIR` (e.g., `/home/wisechef/companies/wisechef`)
- Existing one-shot endpoint: `POST /api/onboarding/one-shot` in `server/controllers/onboardingOneShot.js`
- OpenRouter API key available as `process.env.OPENROUTER_API_KEY`
- Board runs on Express

## Quality
- Page must work perfectly on mobile (test with 375px width)
- All interactive elements need hover/active states
- Loading states for async operations
- Error handling with user-friendly messages
- No console errors
