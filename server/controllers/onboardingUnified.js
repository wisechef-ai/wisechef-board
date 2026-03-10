import fs from 'fs';
import path from 'path';
import { __dirname, WORKSPACE, POST_ONBOARD_URL } from '../config.js';

const ROLES_DIR = path.join(__dirname, 'server', 'templates', 'roles');

const TIER_LIMITS = {
  starter: 1,
  pro: 3,
  enterprise: 20,
};

function normalizeTier(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (raw === 'pro' || raw === 'enterprise' || raw === 'starter') return raw;
  return 'starter';
}

function roleTemplates() {
  if (!fs.existsSync(ROLES_DIR)) return [];
  return fs.readdirSync(ROLES_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const fullPath = path.join(ROLES_DIR, file);
      try {
        return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      } catch (err) {
        console.error('[onboarding/roles] Failed to parse template:', fullPath, err.message);
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

function clampNumber(value, fallback = 0.5) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

function toSlug(value, fallback) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function renderTemplate(template, context) {
  return String(template || '').replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key) => {
    return Object.prototype.hasOwnProperty.call(context, key) ? String(context[key] || '') : '';
  });
}

function ensureUniqueAgentDir(baseName, used) {
  let attempt = baseName;
  let counter = 2;
  while (used.has(attempt) || fs.existsSync(path.join(WORKSPACE, 'agents', attempt))) {
    attempt = `${baseName}-${counter}`;
    counter += 1;
  }
  used.add(attempt);
  return attempt;
}

export function getOnboardingTier(_req, res) {
  const tier = normalizeTier(process.env.WISECHEF_PLAN || process.env.WISECHEF_TIER);
  res.json({ tier, limits: { agents: TIER_LIMITS[tier] } });
}

export function getOnboardingRoles(_req, res) {
  const roles = roleTemplates();
  res.json({ roles });
}

export function unifiedOnboarding(req, res) {
  try {
    const payload = req.body || {};
    const tier = normalizeTier(payload.tier || process.env.WISECHEF_PLAN || process.env.WISECHEF_TIER);
    const maxAgents = TIER_LIMITS[tier];

    const companyIn = payload.company && typeof payload.company === 'object' ? payload.company : {};
    const company = {
      name: String(companyIn.name || '').trim(),
      description: String(companyIn.description || '').trim(),
      industry: String(companyIn.industry || '').trim(),
      size: String(companyIn.size || '').trim(),
      language: String(companyIn.language || 'English').trim() || 'English',
    };

    if (!company.name) {
      return res.status(400).json({ error: 'Company name is required.' });
    }

    const incomingAgents = Array.isArray(payload.agents) ? payload.agents : [];
    if (incomingAgents.length < 1) {
      return res.status(400).json({ error: 'Select at least one role.' });
    }
    if (incomingAgents.length > maxAgents) {
      return res.status(400).json({ error: `Tier limit exceeded. Max agents for ${tier} is ${maxAgents}.` });
    }

    const templates = roleTemplates();
    const templateMap = new Map(templates.map((role) => [role.id, role]));

    const agentsRoot = path.join(WORKSPACE, 'agents');
    fs.mkdirSync(agentsRoot, { recursive: true });

    const usedSlugs = new Set();
    const resolvedAgents = incomingAgents.map((rawAgent) => {
      const roleId = String(rawAgent.roleId || '').trim();
      const roleTemplate = templateMap.get(roleId);
      if (!roleTemplate) {
        throw new Error(`Unknown role template: ${roleId || '(missing roleId)'}`);
      }

      const displayName = String(rawAgent.displayName || roleTemplate.name || roleId).trim() || roleTemplate.name;
      const personalityIn = rawAgent.personality && typeof rawAgent.personality === 'object' ? rawAgent.personality : {};
      const personality = {
        formality: clampNumber(personalityIn.formality, roleTemplate.personality?.formality ?? 0.6),
        proactivity: clampNumber(personalityIn.proactivity, roleTemplate.personality?.proactivity ?? 0.8),
      };

      const priorityFocus = String(rawAgent.priorityFocus || '').trim();
      const telegramGroup = String(rawAgent.telegramGroup || '').trim();

      const baseSlug = toSlug(`${roleId}-${displayName}`, toSlug(roleId, 'agent'));
      const agentSlug = ensureUniqueAgentDir(baseSlug, usedSlugs);
      const agentDir = path.join(agentsRoot, agentSlug);
      fs.mkdirSync(agentDir, { recursive: true });

      const context = {
        company_name: company.name,
        company_description: company.description,
        company_industry: company.industry,
        company_size: company.size,
        company_language: company.language,
        role_name: roleTemplate.name,
        display_name: displayName,
        priority_focus: priorityFocus || roleTemplate.shortDescription || 'Execution excellence',
      };

      const soul = renderTemplate(roleTemplate.soulTemplate, context);
      const heartbeat = renderTemplate(roleTemplate.heartbeatTemplate, context);

      fs.writeFileSync(path.join(agentDir, 'SOUL.md'), `${soul.trim()}\n`, 'utf8');
      fs.writeFileSync(path.join(agentDir, 'HEARTBEAT.md'), `${heartbeat.trim()}\n`, 'utf8');
      fs.writeFileSync(path.join(agentDir, 'role.json'), JSON.stringify({
        roleId,
        roleName: roleTemplate.name,
        category: roleTemplate.category,
        displayName,
        personality,
        priorityFocus,
        defaultTools: Array.isArray(roleTemplate.defaultTools) ? roleTemplate.defaultTools : [],
        telegramGroup: telegramGroup || null,
      }, null, 2), 'utf8');

      if (tier === 'enterprise' && telegramGroup) {
        fs.writeFileSync(path.join(agentDir, 'channel-config.json'), JSON.stringify({
          channel: 'telegram',
          group: telegramGroup,
          configuredAt: new Date().toISOString(),
        }, null, 2), 'utf8');
      }

      return {
        id: agentSlug,
        roleId,
        roleName: roleTemplate.name,
        category: roleTemplate.category,
        displayName,
        personality,
        priorityFocus,
        telegramGroup: telegramGroup || null,
      };
    });

    if (resolvedAgents.length > 0) {
      const primaryAgentDir = path.join(agentsRoot, resolvedAgents[0].id);
      try {
        fs.copyFileSync(path.join(primaryAgentDir, 'SOUL.md'), path.join(WORKSPACE, 'SOUL.md'));
        fs.copyFileSync(path.join(primaryAgentDir, 'HEARTBEAT.md'), path.join(WORKSPACE, 'HEARTBEAT.md'));
      } catch (err) {
        console.error('[onboarding/unified] Failed to copy primary profile:', err.message);
      }
    }

    const metadata = {
      completed: new Date().toISOString(),
      method: 'unified',
      tier,
      company,
      agents: resolvedAgents,
    };

    fs.mkdirSync(WORKSPACE, { recursive: true });
    fs.writeFileSync(path.join(WORKSPACE, 'onboarding-complete.json'), JSON.stringify(metadata, null, 2), 'utf8');

    const redirect = tier === 'enterprise' ? '/dashboard' : (POST_ONBOARD_URL || '/');
    return res.json({ success: true, redirect });
  } catch (err) {
    console.error('[onboarding/unified] Error:', err.message);
    return res.status(500).json({ error: 'Failed to complete onboarding.' });
  }
}
