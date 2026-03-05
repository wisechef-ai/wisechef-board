/**
 * server/controllers/enterprise.js
 *
 * Enterprise onboarding endpoints:
 *   POST /api/enterprise/onboard        — receive wizard answers, save company.json, notify team
 *   POST /api/enterprise/interview-ack  — optional AI acknowledgement between steps (graceful degradation)
 */

import fs   from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const CLIENTS_DIR = path.resolve(process.env.HOME, 'clawd/wisechef/clients');
const INBOX_FILE  = path.resolve(process.env.HOME, 'companies/wisechef/shared/inbox/to-ceo.md');

// ── POST /api/enterprise/onboard ─────────────────────────────────────────────
export async function enterpriseOnboard(req, res) {
  const { answers } = req.body || {};
  if (!answers?.intro) return res.status(400).json({ error: 'answers.intro required' });

  try {
    const company     = buildCompanyConfig(answers);
    const clientDir   = path.join(CLIENTS_DIR, company.slug);
    fs.mkdirSync(clientDir, { recursive: true });

    // Save company.json
    const companyPath = path.join(clientDir, 'company.json');
    fs.writeFileSync(companyPath, JSON.stringify(company, null, 2));
    console.log(`[enterprise] company.json → ${companyPath}`);

    // Save raw intake for audit trail
    fs.writeFileSync(
      path.join(clientDir, 'intake.json'),
      JSON.stringify({ answers, receivedAt: new Date().toISOString() }, null, 2)
    );

    // Write pending marker for provisioner
    fs.writeFileSync(
      path.join(clientDir, 'provisioning-pending.json'),
      JSON.stringify({
        status:    'pending',
        slug:      company.slug,
        createdAt: new Date().toISOString(),
        note:      'Run: wisechef-enterprise provision --config company.json --auto-groups',
      }, null, 2)
    );

    // Notify CEO inbox (best-effort)
    notifyCEO(company, clientDir);

    res.json({
      ok:          true,
      slug:        company.slug,
      companyName: company.name,
      departments: company.departments.length,
    });
  } catch (err) {
    console.error('[enterprise] onboard error:', err);
    res.status(500).json({ error: err.message });
  }
}

// ── POST /api/enterprise/interview-ack ───────────────────────────────────────
// Optional AI-generated acknowledgement between wizard steps.
// Uses openclaw agent in a stateless one-shot mode — timeout is short,
// caller ignores errors and falls back to scripted next question.
export function enterpriseInterviewAck(req, res) {
  const { stepKey, answer, allAnswers } = req.body || {};
  if (!stepKey || !answer) return res.json({ ack: null });

  const ACK_PROMPTS = {
    intro:        `The user just told you their company name and description: "${answer}". Give a warm, 1-sentence acknowledgement (max 12 words). Just the sentence, no preamble.`,
    region:       `The user is based in "${answer}". Give a short 1-sentence friendly acknowledgement. Max 10 words.`,
    language:     `The user's agents will speak "${answer}". Confirm in 1 sentence. Max 10 words.`,
    departments:  `The user described their departments: "${answer.slice(0, 200)}". Acknowledge enthusiastically in 1-2 sentences. Max 20 words.`,
    owner:        `The user introduced themselves as "${answer}". Greet them warmly in 1 sentence. Max 12 words.`,
    extras:       null, // no ack — go straight to submit
  };

  const prompt = ACK_PROMPTS[stepKey];
  if (!prompt) return res.json({ ack: null });

  try {
    const escaped = prompt.replace(/'/g, "'\\''").replace(/\\/g, '\\\\');
    const ack = execSync(
      `openclaw agent -m '${escaped}' --session-id enterprise-ack-${Date.now()} --no-memory`,
      { timeout: 7000, encoding: 'utf8', maxBuffer: 64 * 1024 }
    ).trim();
    res.json({ ack: ack.slice(0, 200) });
  } catch {
    // Graceful degradation — frontend will skip ack and continue
    res.json({ ack: null });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildCompanyConfig(answers) {
  // answers.intro: "Inter-Plus — telco provider in Chełm"
  const introLine   = answers.intro?.trim() || 'My Company';
  const [namePart]  = introLine.split(/\s*[—–-]\s*/);
  const name        = namePart.trim() || introLine;
  const slug        = slugify(name);

  const language    = detectLanguage(answers.language || '');
  const timezone    = detectTimezone(answers.region || '');

  // Parse owner: "Jan Kowalski, CEO — jan@company.com"
  const ownerRaw    = answers.owner || '';
  const emailMatch  = ownerRaw.match(/[\w.+-]+@[\w.-]+\.\w+/);
  const ownerNoEmail= ownerRaw.replace(emailMatch?.[0] || '', '').replace(/[—–-]+/, '').trim();
  const [ownerName, ...ownerRoleParts] = ownerNoEmail.split(/,\s*/);
  const ownerRole   = ownerRoleParts.join(', ').trim() || 'Owner';

  // Parse departments from free-text
  const departments = parseDepartments(answers.departments || '', name, language);

  // Parse integrations
  const extrasLower = (answers.extras || '').toLowerCase();
  const integrations = extrasLower === 'none' || extrasLower === 'brak'
    ? []
    : extractIntegrations(answers.extras || '');

  return {
    schemaVersion: 1,
    slug,
    name,
    description: introLine,
    industry:    detectIndustry(introLine),
    region:      (answers.region || '').trim(),
    language,
    timezone,
    owner: {
      name:  (ownerName || '').trim(),
      role:  ownerRole,
      email: emailMatch?.[0] || undefined,
    },
    contacts:     [],
    departments,
    integrations,
    plan:         'enterprise-5',
    notes:        answers.extras !== 'none' ? answers.extras : undefined,
    _source:      'enterprise-wizard',
    _createdAt:   new Date().toISOString(),
  };
}

function parseDepartments(raw, companyName, language) {
  const lines = raw.split(/\n/).map(l => l.trim()).filter(Boolean);
  const roleCounters = {};
  return lines.map((line, i) => {
    // Accept formats: "Name — description" or "Name: description" or just "Name"
    const [deptPart, ...descParts] = line.split(/\s*[—–:-]\s*/);
    const deptName  = deptPart.trim();
    const workflows = descParts.length
      ? descParts.join(' ').split(/,\s*/).map(s => s.trim()).filter(Boolean)
      : [`Handle ${deptName} operations`];

    const role      = inferRole(deptName, i);
    const agentName = inferAgentName(role, roleCounters);
    const id        = slugify(deptName);

    return {
      id,
      name:             deptName,
      agentName,
      agentRole:        role,
      workflows,
      telegramGroupName: `${companyName} — ${deptName}`,
    };
  });
}

function slugify(str) {
  return (str || '')
    .toLowerCase()
    .replace(/ą/g,'a').replace(/ę/g,'e').replace(/ó/g,'o').replace(/ś/g,'s')
    .replace(/ł/g,'l').replace(/ż/g,'z').replace(/ź/g,'z').replace(/ć/g,'c').replace(/ń/g,'n')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    || 'company';
}

function detectLanguage(raw) {
  const r = (raw || '').toLowerCase();
  if (r.includes('polish') || r.includes('polski') || r.startsWith('pl')) return 'pl';
  if (r.includes('german') || r.includes('deutsch') || r.startsWith('de')) return 'de';
  if (r.includes('french') || r.includes('français') || r.startsWith('fr')) return 'fr';
  if (r.includes('spanish') || r.includes('español') || r.startsWith('es')) return 'es';
  return 'en';
}

function detectTimezone(region) {
  const r = (region || '').toLowerCase();
  if (/poland|polska|warszawa|krakow|wroclaw|chelm|łódź|lodz|poznan|gdansk/i.test(r)) return 'Europe/Warsaw';
  if (/germany|berlin|münchen|munich|frankfurt|hamburg/i.test(r)) return 'Europe/Berlin';
  if (/uk|united kingdom|london|manchester|edinburgh/i.test(r)) return 'Europe/London';
  if (/france|paris|lyon|marseille/i.test(r)) return 'Europe/Paris';
  if (/czech|prague|praha/i.test(r)) return 'Europe/Prague';
  if (/austria|wien|vienna/i.test(r)) return 'Europe/Vienna';
  return 'Europe/Warsaw'; // default to CET for CEE context
}

function detectIndustry(intro) {
  const i = (intro || '').toLowerCase();
  if (/telco|internet|telecom|fiber|fibre|broadband|tv|cable/i.test(i)) return 'telco';
  if (/logistics|delivery|transport|freight|cargo|shipping/i.test(i)) return 'logistics';
  if (/restaurant|food|catering|kitchen|dining/i.test(i)) return 'food';
  if (/retail|shop|store|ecommerce|e-commerce/i.test(i)) return 'retail';
  if (/real estate|property|nieruchomości|mieszkania/i.test(i)) return 'real-estate';
  if (/health|medical|clinic|hospital|pharma/i.test(i)) return 'healthcare';
  if (/education|school|university|training|elearning/i.test(i)) return 'education';
  if (/construction|building|budowlany|instalacje/i.test(i)) return 'construction';
  if (/finance|fintech|bank|insurance|accounting/i.test(i)) return 'finance';
  if (/software|saas|tech|it |digital/i.test(i)) return 'tech';
  return 'other';
}

function inferRole(deptName, index) {
  const n = (deptName || '').toLowerCase();
  if (index === 0 || /manag|director|ceo|chief|dyrekcja|zarząd|board|exec/i.test(n)) return 'orchestrator';
  if (/field|tech|install|ops|dispatch|dysp|montaż|serwis|service|technician/i.test(n)) return 'field-ops';
  if (/support|obsług|customer|client|helpdesk|biuro|contact|service desk/i.test(n)) return 'customer-support';
  if (/market|growth|social|reklam|nova|promo|brand|digital/i.test(n)) return 'marketing';
  if (/sales|sprzedaż|handl|commercial|revenue|account/i.test(n)) return 'sales';
  if (/hr|human|people|kadry|recruitment|hiring/i.test(n)) return 'hr';
  if (/admin|finance|billing|account|księgow|administr|invoic/i.test(n)) return 'admin';
  return 'admin';
}

const AGENT_NAMES_BY_ROLE = {
  'orchestrator':     ['MARCO', 'ARIA', 'APEX', 'CORE'],
  'field-ops':        ['DISPATCH', 'FIELD', 'OPS', 'TECH'],
  'customer-support': ['SUPPORT', 'CARA', 'HELP', 'RELAY'],
  'marketing':        ['NOVA', 'SPARK', 'BRAND', 'PULSE'],
  'admin':            ['ADMIN', 'VERA', 'BASE', 'CORE'],
  'sales':            ['SALES', 'ACE', 'BOOST', 'REACH'],
  'hr':               ['HR', 'PEOPLE', 'HIRE', 'TALENT'],
};

function inferAgentName(role, counters) {
  counters[role] = counters[role] || 0;
  const names = AGENT_NAMES_BY_ROLE[role] || ['AGENT'];
  const name  = names[counters[role] % names.length];
  counters[role]++;
  return name;
}

function extractIntegrations(raw) {
  return (raw || '')
    .split(/[,;]/)
    .map(s => s.trim().toLowerCase().split(/\s+/)[0])
    .filter(s => s && s !== 'none' && s !== 'brak' && s.length > 1)
    .map(s => slugify(s));
}

function notifyCEO(company, clientDir) {
  try {
    const entry =
      `\n\n## 🆕 Enterprise Onboarding — ${company.name} (${new Date().toISOString().slice(0,10)})\n` +
      `- **Slug:** \`${company.slug}\`\n` +
      `- **Industry:** ${company.industry}\n` +
      `- **Region:** ${company.region}\n` +
      `- **Language:** ${company.language}\n` +
      `- **Owner:** ${company.owner.name} (${company.owner.role})\n` +
      `- **Departments (${company.departments.length}):** ${company.departments.map(d => `${d.name} [${d.agentName}]`).join(', ')}\n` +
      `- **Integrations:** ${company.integrations.join(', ') || 'none'}\n` +
      `- **company.json:** \`${clientDir}/company.json\`\n` +
      `- **Action:** Run \`wisechef-enterprise provision --config ${clientDir}/company.json --auto-groups\` once Telegram credentials are ready.\n`;
    fs.appendFileSync(INBOX_FILE, entry);
  } catch { /* best-effort */ }
}
