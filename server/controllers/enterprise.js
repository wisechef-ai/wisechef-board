/**
 * server/controllers/enterprise.js
 *
 * Enterprise onboarding endpoints:
 *   POST /api/enterprise/onboard        — legacy: receive wizard answers, save company.json
 *   POST /api/enterprise/provision      — new: receive company object, generate workspace, restart gateway
 *   POST /api/enterprise/interview-ack  — optional AI ack between wizard steps
 */

import fs   from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const CLIENTS_DIR    = path.resolve(process.env.HOME, 'clawd/wisechef/clients');
const INBOX_FILE     = path.resolve(process.env.HOME, 'companies/wisechef/shared/inbox/to-ceo.md');
const ENTERPRISE_CLI = path.resolve(process.env.HOME, 'companies/wisechef/wisechef-enterprise/cli.js');
// Client openclaw paths — env-overridable for dev (where it's under ~wisechef/)
const OPENCLAW_WS   = process.env.OPENCLAW_WORKSPACE   || '/root/.openclaw/workspace';
const OPENCLAW_JSON = process.env.OPENCLAW_CONFIG_PATH || '/root/.openclaw/openclaw.json';

// ── POST /api/enterprise/provision ──────────────────────────────────────────
// Full provisioning:
//   1. Save company.json
//   2. node wisechef-enterprise/cli.js generate → SOUL/MEMORY/HEARTBEAT/system-prompts
//   3. Patch openclaw.json with per-dept systemPrompts + existing chatIds
//   4. systemctl restart openclaw-gateway.service
//   5. Return { ok, files: [...], groups: [...] }
export async function enterpriseProvision(req, res) {
  const { company } = req.body || {};
  if (!company?.slug || !company?.departments?.length) {
    return res.status(400).json({ error: 'company.slug and departments[] required' });
  }

  const slug      = company.slug;
  const clientDir = path.join(CLIENTS_DIR, slug);

  try {
    // ── 1. Save company.json ───────────────────────────────────────────────
    fs.mkdirSync(clientDir, { recursive: true });
    const companyPath = path.join(clientDir, 'company.json');
    fs.writeFileSync(companyPath, JSON.stringify(company, null, 2));
    console.log(`[provision] company.json → ${companyPath}`);

    // ── 2. Generate workspace files ────────────────────────────────────────
    let files = [];
    try {
      const out = execSync(
        `node '${ENTERPRISE_CLI}' generate --config '${companyPath}' --workspace '${OPENCLAW_WS}'`,
        { timeout: 30000, encoding: 'utf8', maxBuffer: 512 * 1024 }
      );
      // CLI logs lines like "✅ wrote SOUL.md" or "✅ system-prompts/marco.txt"
      files = (out.match(/✅[^\n]+/g) || []).map(l => l.replace(/✅\s*/, '').trim());
      console.log(`[provision] generate OK — ${files.length} files`);
    } catch (genErr) {
      console.warn('[provision] generate non-fatal:', (genErr.stderr || genErr.message).slice(0, 200));
    }

    // ── 3. Patch openclaw.json ─────────────────────────────────────────────
    let groups = [];
    try {
      groups = patchOpencLawJson(company, clientDir);
      console.log(`[provision] openclaw.json patched — ${groups.length} group entries`);
    } catch (patchErr) {
      console.warn('[provision] openclaw.json patch non-fatal:', patchErr.message);
      // Build groups list from company.json even if patch failed
      groups = company.departments.map(d => ({
        agentId: d.id, agentName: d.agentName, agentRole: d.agentRole,
        telegramGroupName: d.telegramGroupName, chatId: null, status: 'pending',
      }));
    }

    // ── 4. Restart gateway ─────────────────────────────────────────────────
    let gatewayRestarted = false;
    try {
      execSync('systemctl restart openclaw-gateway.service', { timeout: 15000, encoding: 'utf8' });
      gatewayRestarted = true;
    } catch {
      try {
        // fallback for dev VPS where it may be named differently
        execSync('openclaw gateway restart', { timeout: 12000, encoding: 'utf8' });
        gatewayRestarted = true;
      } catch (e2) {
        console.warn('[provision] gateway restart failed (non-fatal):', e2.message);
      }
    }

    // ── 5. Write markers ───────────────────────────────────────────────────
    fs.writeFileSync(path.join(clientDir, 'provisioning-pending.json'), JSON.stringify({
      status: 'pending-telegram', slug, files, groups, gatewayRestarted,
      createdAt: new Date().toISOString(),
      note: 'Run: wisechef-enterprise provision --config company.json --auto-groups',
    }, null, 2));
    fs.writeFileSync(path.join(clientDir, 'intake.json'), JSON.stringify({
      company, receivedAt: new Date().toISOString(),
    }, null, 2));

    notifyCEO(company, clientDir);

    res.json({ ok: true, slug, companyName: company.name, files, groups, gatewayRestarted });

  } catch (err) {
    console.error('[provision] error:', err);
    res.status(500).json({ error: err.message });
  }
}

// ── Patch openclaw.json with systemPrompts and existing chatIds ──────────────
function patchOpencLawJson(company, clientDir) {
  // Load existing chatIds from deployment.json (keyed by dept.id or agentName)
  let chatIds = {};
  try {
    const dep = JSON.parse(fs.readFileSync(path.join(clientDir, 'deployment.json'), 'utf8'));
    chatIds = dep.chatIds || dep.groups || {};
  } catch { /* no deployment yet — all groups will be pending */ }

  // Load or init openclaw.json
  let config = {};
  try { config = JSON.parse(fs.readFileSync(OPENCLAW_JSON, 'utf8')); } catch {}
  if (!config.channels)                     config.channels = {};
  if (!config.channels.telegram)            config.channels.telegram = {};
  const tg = config.channels.telegram;
  tg.enabled      = true;
  tg.dmPolicy     = 'disabled';      // NEVER 'pairing'
  tg.groupPolicy  = 'allowlist';
  if (!tg.groups) tg.groups = {};

  const groups = [];
  for (const dept of company.departments) {
    // Read generated system prompt if available
    let systemPrompt = '';
    try {
      systemPrompt = fs.readFileSync(
        path.join(OPENCLAW_WS, 'system-prompts', `${dept.id}.txt`), 'utf8'
      ).trim();
    } catch {}

    // Resolve chatId — try by dept.id, agentName, agentId keys
    const chatId = chatIds[dept.id] || chatIds[dept.agentName?.toLowerCase()]
      || chatIds[dept.agentName] || null;

    const entry = {
      requireMention: false,
      groupPolicy:    'open',
      enabled:        true,
      ...(systemPrompt && { systemPrompt }),
    };

    if (chatId) {
      tg.groups[chatId] = entry;
    }

    groups.push({
      agentId:           dept.id,
      agentName:         dept.agentName,
      agentRole:         dept.agentRole,
      telegramGroupName: dept.telegramGroupName || `${company.name} — ${dept.name}`,
      chatId:            chatId || null,
      status:            chatId ? 'configured' : 'pending',
      inviteLink:        null,
    });
  }

  // Write back only if the file exists (don't create it on remote if missing)
  if (fs.existsSync(OPENCLAW_JSON)) {
    fs.writeFileSync(OPENCLAW_JSON, JSON.stringify(config, null, 2));
  }

  return groups;
}

// ── POST /api/enterprise/onboard (legacy — kept for backwards compat) ─────────
export async function enterpriseOnboard(req, res) {
  const { answers } = req.body || {};
  if (!answers?.intro) return res.status(400).json({ error: 'answers.intro required' });

  try {
    const company     = buildCompanyConfig(answers);
    const clientDir   = path.join(CLIENTS_DIR, company.slug);
    fs.mkdirSync(clientDir, { recursive: true });

    fs.writeFileSync(path.join(clientDir, 'company.json'), JSON.stringify(company, null, 2));
    fs.writeFileSync(path.join(clientDir, 'intake.json'),
      JSON.stringify({ answers, receivedAt: new Date().toISOString() }, null, 2));
    fs.writeFileSync(path.join(clientDir, 'provisioning-pending.json'),
      JSON.stringify({ status:'pending', slug: company.slug, createdAt: new Date().toISOString() }, null, 2));

    notifyCEO(company, clientDir);

    res.json({ ok: true, slug: company.slug, companyName: company.name, departments: company.departments.length });
  } catch (err) {
    console.error('[enterprise] onboard error:', err);
    res.status(500).json({ error: err.message });
  }
}

// ── POST /api/enterprise/interview-ack ───────────────────────────────────────
export function enterpriseInterviewAck(req, res) {
  const { stepKey, answer } = req.body || {};
  if (!stepKey || !answer) return res.json({ ack: null });

  const PROMPTS = {
    intro:       `The user said their company is: "${answer.slice(0,100)}". Give a warm 1-sentence acknowledgement. Max 12 words. No preamble.`,
    region:      `The user is based in "${answer}". 1 sentence, max 10 words.`,
    language:    `The user's agents will speak "${answer}". Confirm in 1 sentence, max 10 words.`,
    departments: `The user described their departments. Acknowledge enthusiastically in 1-2 sentences. Max 20 words.`,
    owner:       `The user introduced themselves as "${answer.slice(0,80)}". Greet them in 1 sentence. Max 12 words.`,
    pain:        null, // skip — go straight to synthesis
  };

  const prompt = PROMPTS[stepKey];
  if (!prompt) return res.json({ ack: null });

  try {
    const escaped = prompt.replace(/'/g, "'\\''");
    const ack = execSync(
      `openclaw agent -m '${escaped}' --session-id enterprise-ack-${Date.now()} --no-memory`,
      { timeout: 6000, encoding: 'utf8', maxBuffer: 32 * 1024 }
    ).trim();
    res.json({ ack: ack.slice(0, 200) });
  } catch {
    res.json({ ack: null });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildCompanyConfig(answers) {
  const introLine = answers.intro?.trim() || 'My Company';
  const [namePart] = introLine.split(/\s*[—–-]\s*/);
  const name  = namePart.trim() || introLine;
  const slug  = slugify(name);
  const depts = parseDepartments(answers.departments || '', name);
  const [ownerName, ...ownerRoleParts] = (answers.owner || '').split(/,\s*/);
  return {
    schemaVersion: 1, slug, name,
    description: introLine,
    industry:   detectIndustry(introLine),
    region:     (answers.region || '').trim(),
    language:   detectLanguage(answers.language),
    timezone:   detectTimezone(answers.region),
    owner:      { name: (ownerName||'').trim(), role: ownerRoleParts.join(', ').trim() || 'Owner' },
    contacts:   [],
    departments: depts,
    integrations: [],
    plan: 'enterprise-5',
    painPoint: answers.pain,
    _source: 'enterprise-wizard', _createdAt: new Date().toISOString(),
  };
}

function parseDepartments(raw, companyName='') {
  const used = new Set();
  return raw.split('\n').map(l=>l.trim()).filter(Boolean).map((line, i) => {
    const [namePart, ...descParts] = line.split(/\s*[—–:-]\s*/);
    const name = namePart.trim();
    const workflows = descParts.length
      ? descParts.join(' ').split(/,\s*/).map(s=>s.trim()).filter(Boolean)
      : [`Handle ${name} operations`];
    const role = inferRole(name, i);
    const agentName = nextName(role, used);
    used.add(agentName);
    return { id: slugify(name), name, agentName, agentRole: role, workflows,
      telegramGroupName: `${companyName} — ${name}` };
  });
}

const ROLE_NAMES = {
  'orchestrator':    ['MARCO','ARIA','APEX'],
  'field-ops':       ['DISPATCH','FIELD','OPS'],
  'customer-support':['SUPPORT','CARA','HELP'],
  'marketing':       ['NOVA','SPARK','BRAND'],
  'admin':           ['ADMIN','VERA','BASE'],
  'sales':           ['SALES','ACE','BOOST'],
  'finance':         ['FINANCE','LEDGER'],
  'hr':              ['HR','PEOPLE'],
};
function nextName(role, used) {
  const names = ROLE_NAMES[role] || ['AGENT'];
  return names.find(n => !used.has(n)) || `${role.toUpperCase().slice(0,6)}-${used.size}`;
}

function slugify(s='') {
  return s.toLowerCase()
    .replace(/ą/g,'a').replace(/ę/g,'e').replace(/ó/g,'o').replace(/ś/g,'s')
    .replace(/ł/g,'l').replace(/ż/g,'z').replace(/ź/g,'z').replace(/ć/g,'c').replace(/ń/g,'n')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'company';
}
function detectLanguage(r='') {
  const l=r.toLowerCase();
  if (/polish|polski|^pl/.test(l)) return 'pl';
  if (/german|deutsch|^de/.test(l)) return 'de';
  return 'en';
}
function detectTimezone(r='') {
  if (/poland|polska|warszawa|chelm|krakow|wroclaw/i.test(r)) return 'Europe/Warsaw';
  if (/germany|berlin/i.test(r)) return 'Europe/Berlin';
  return 'Europe/Warsaw';
}
function detectIndustry(t='') {
  const i=t.toLowerCase();
  if (/telco|internet|telecom|fiber/i.test(i)) return 'telco';
  if (/logistics|delivery|transport/i.test(i)) return 'logistics';
  if (/food|restaurant|catering/i.test(i)) return 'food';
  if (/health|medical|clinic/i.test(i)) return 'healthcare';
  if (/software|saas|tech|it /i.test(i)) return 'tech';
  return 'other';
}
function inferRole(name, idx) {
  const n=(name||'').toLowerCase();
  if (idx===0 || /manag|director|ceo|chief|dyrekcja/i.test(n)) return 'orchestrator';
  if (/field|tech|install|ops|dispatch|dysp/i.test(n)) return 'field-ops';
  if (/support|obsług|customer|helpdesk/i.test(n)) return 'customer-support';
  if (/market|growth|social|reklam/i.test(n)) return 'marketing';
  if (/sales|sprzedaż|handl/i.test(n)) return 'sales';
  if (/finance|billing|księgow/i.test(n)) return 'finance';
  if (/hr|human|people|kadry/i.test(n)) return 'hr';
  return 'admin';
}

function notifyCEO(company, clientDir) {
  try {
    const entry =
      `\n\n## 🆕 Enterprise Onboarding — ${company.name} (${new Date().toISOString().slice(0,10)})\n` +
      `- **Slug:** \`${company.slug}\`\n` +
      `- **Owner:** ${company.owner?.name} (${company.owner?.role})\n` +
      `- **Departments (${company.departments?.length}):** ${company.departments?.map(d=>`${d.name} [${d.agentName}]`).join(', ')}\n` +
      `- **company.json:** \`${clientDir}/company.json\`\n` +
      `- **Action:** Run \`wisechef-enterprise provision --config ${clientDir}/company.json --auto-groups\` once Telegram credentials ready.\n`;
    fs.appendFileSync(INBOX_FILE, entry);
  } catch { /* best-effort */ }
}


