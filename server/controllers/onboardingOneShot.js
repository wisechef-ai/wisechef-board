import fs from 'fs';
import path from 'path';
import { WORKSPACE, AGENT_TYPES_ENABLED, POST_ONBOARD_URL } from '../config.js';

// ──── One-Shot Onboarding — AI-powered identity generation ────
//
// POST /api/onboarding/generate
//   Body: { userInput: string }
//   Returns: { agent_type, soul_md, skills, intro_message }
//
// POST /api/onboarding/one-shot
//   Body: { userInput: string }
//   Full pipeline: generate → write SOUL.md → write sentinel → write onboarding-complete.json
//   Returns: { ok, redirect, agentType, introMessage }

const VALID_TYPES = ['personal-assistant', 'ruthless-mentor', 'executive-assistant', 'generalist'];

/**
 * Build a sensible fallback config when the model call fails.
 * Ensures onboarding ALWAYS completes — user can customize SOUL.md later.
 */
function buildFallbackConfig({ companyName, focusArea, language, userInput }) {
  const name = companyName || 'Your Company';
  const lang = language || 'English';
  const focus = focusArea || 'General';

  // Map focus area to agent type
  const typeMap = {
    'Customer Support': 'sales-assistant',
    'Operations': 'executive-assistant',
    'Everything': 'generalist',
  };
  const agent_type = typeMap[focus] || 'generalist';

  const soul_md = `# SOUL.md — ${name}

## Identity
You are Chef, a personal AI assistant for **${name}**, powered by WiseChef.

## Communication Style
- Be helpful, concise, and direct
- No filler phrases — just help
- Speak in ${lang}
- If you're not sure about something, say so

## Priorities
- Focus area: ${focus}
- ${userInput ? `Context: ${userInput}` : 'Help with daily operations and tasks'}

## How I Work
- Proactive — anticipate needs
- Track commitments and follow up
- Respect time — no noise
- Flag risks early
- Learn and adapt

## What I Avoid
- Overcomplicating simple tasks
- Making assumptions without checking
- Being passive — always suggest next steps
`;

  const skillMap = {
    'Customer Support': ['proactive-agent', 'summarize'],
    'Operations': ['google-workspace', 'proactive-agent'],
    'Everything': ['proactive-agent', 'summarize'],
  };
  const skills = skillMap[focus] || ['proactive-agent'];

  const intro_message = `Hi! I'm Chef, your AI assistant for ${name}. I'm set up and ready to help with ${focus.toLowerCase()}. What would you like to tackle first?`;

  return { agent_type, soul_md, skills, intro_message };
}

const GENERATION_PROMPT = (userInput, { companyName, focusArea, language } = {}) => {
  const structured = [
    companyName ? `Company/Name: ${companyName}` : null,
    focusArea   ? `Primary focus area: ${focusArea}` : null,
    language    ? `Language for the agent: ${language}` : null,
  ].filter(Boolean).join('\n');

  // Map focus area to a recommended agent type hint
  const focusHint = {
    'Customer Support': 'Lean towards generalist or sales-assistant.',
    'Operations':       'Lean towards executive-assistant.',
    'Everything':       'Lean towards generalist.',
  }[focusArea] || '';

  return `You are configuring a business AI assistant for WiseChef AI.

${structured ? `Structured fields provided:\n${structured}\n` : ''}${userInput ? `Additional description: "${userInput}"` : ''}

Based on these details, generate a complete agent configuration. Be specific — use the company name, focus area, and language provided.
${focusHint}

Available agent types:
- generalist: General-purpose assistant, productivity, tasks, daily briefings
- marketing: Content creation, social media, growth, campaigns, TikTok/LinkedIn
- executive-assistant: Scheduling, briefings, follow-ups, email management, admin
- health-coach: Morning routines, wellness tracking, nutrition, lifestyle habits, biohacking
- security-auditor: Vulnerability scanning, security reviews, infrastructure audits (technical)
- sales-assistant: Sell products, qualify leads, draft pitches, follow up with prospects, close deals

Return ONLY a valid JSON object with these exact fields:
{
  "agent_type": "<one of the slugs above>",
  "soul_md": "<full SOUL.md content as a string — minimum 200 words, personalised to the company/person. Write in ${language || 'English'}.>",
  "skills": ["<skill-slug>", ...],
  "intro_message": "<warm, personal first message from the agent, written in ${language || 'English'}. Reference the company/person. 2-3 sentences.>"
}

For soul_md, write a complete SOUL.md that includes:
- # SOUL.md — [company/agent name]
- ## Identity (name, role, personality — reference ${companyName || 'the company'})
- ## Communication Style (inferred from focus area and industry)
- ## Priorities (focus area: ${focusArea || 'general'})
- ## How I Work (their work style, tools, ${language || 'English'} language)
- ## What I Avoid (inferred from focus area)

For skills, choose from: ["larry", "google-workspace", "healthcheck", "proactive-agent", "summarize"]
Only include skills that genuinely fit their use case.`;
};

async function callOpenRouter(userInput, structured = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://wisechef.ai',
      'X-Title': 'WiseChef One-Shot Onboarding',
    },
    body: JSON.stringify({
      model: (process.env.WISECHEF_MODEL || 'anthropic/claude-sonnet-4.6').replace('openrouter/', ''),
      messages: [{ role: 'user', content: GENERATION_PROMPT(userInput, structured) }],
      max_tokens: 800,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(45000),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Empty response from model (content was empty or missing)');

  // Extract JSON — model may wrap in ```json ... ```
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || content.match(/(\{[\s\S]*\})/);
  const raw = jsonMatch ? jsonMatch[1].trim() : content;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Model returned invalid JSON');
  }

  return parsed;
}

function validateAndSanitize(parsed) {
  // agent_type
  const agent_type = VALID_TYPES.includes(parsed.agent_type) ? parsed.agent_type : 'generalist';

  // soul_md — must be a non-empty string
  const soul_md = typeof parsed.soul_md === 'string' && parsed.soul_md.length > 50
    ? parsed.soul_md
    : `# SOUL.md\n\nYou are a helpful personal AI assistant. Be proactive, concise, and supportive.`;

  // skills — filter to known slugs
  const ALLOWED_SKILLS = ['larry', 'google-workspace', 'healthcheck', 'proactive-agent', 'summarize'];
  const skills = Array.isArray(parsed.skills)
    ? parsed.skills.filter(s => ALLOWED_SKILLS.includes(s))
    : [];

  // intro_message
  const intro_message = typeof parsed.intro_message === 'string' && parsed.intro_message.length > 10
    ? parsed.intro_message
    : "Hi! I'm your personal AI assistant. I'm here to help you stay organised and on top of your priorities. What would you like to tackle first?";

  return { agent_type, soul_md, skills, intro_message };
}

/**
 * POST /api/onboarding/generate
 * Dry-run: returns generated config without writing anything.
 * Used by the frontend to preview before committing.
 */
export async function generateOnboarding(req, res) {
  const { userInput, description, companyName, focusArea, language } = req.body;
  const input = userInput || description;
  if (!input || typeof input !== 'string' || input.trim().length < 5) {
    return res.status(400).json({ error: 'Please describe yourself in at least a few words.' });
  }

  try {
    const raw = await callOpenRouter(input.trim(), { companyName, focusArea, language });
    const result = validateAndSanitize(raw);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[onboarding/generate] Error:', err.message);
    // Fallback: return a sensible default instead of failing
    const fallback = buildFallbackConfig({ companyName, focusArea, language, userInput: input.trim() });
    console.log('[onboarding/generate] Using fallback config');
    res.json({ ok: true, ...fallback, fallback: true });
  }
}

/**
 * POST /api/onboarding/one-shot
 * Full pipeline: generate → write files → mark onboarding complete.
 * Body: { userInput: string, companyName?: string, focusArea?: string, language?: string }
 */
export async function oneShotOnboarding(req, res) {
  const { userInput, description, companyName, focusArea, language } = req.body;
  const rawInput = userInput || description;
  if (!rawInput || typeof rawInput !== 'string' || rawInput.trim().length < 5) {
    return res.status(400).json({ error: 'Please describe yourself in at least a few words.' });
  }

  // Build enriched prompt input from structured fields when available
  const enrichedInput = rawInput.trim();

  let result;
  try {
    const raw = await callOpenRouter(enrichedInput, { companyName, focusArea, language });
    result = validateAndSanitize(raw);
  } catch (err) {
    console.error('[onboarding/one-shot] Generation error:', err.message);
    // Fallback: use a sensible default so onboarding ALWAYS completes
    console.log('[onboarding/one-shot] Using fallback config');
    result = buildFallbackConfig({ companyName, focusArea, language, userInput: enrichedInput });
  }

  try {
    const { agent_type, soul_md, skills, intro_message } = result;

    // Write SOUL.md
    fs.writeFileSync(path.join(WORKSPACE, 'SOUL.md'), soul_md, 'utf8');

    // Write agent-type.json sentinel (blocks old onboarding from overwriting SOUL.md)
    fs.writeFileSync(path.join(WORKSPACE, 'agent-type.json'), JSON.stringify({
      id: agent_type,
      setAt: new Date().toISOString(),
      source: 'one-shot',
    }, null, 2));

    // Write onboarding-complete.json (marks onboarding done, same sentinel as wizard)
    fs.writeFileSync(path.join(WORKSPACE, 'onboarding-complete.json'), JSON.stringify({
      completed: new Date().toISOString(),
      method: 'one-shot',
      companyName: companyName || null,
      focusArea: focusArea || null,
      language: language || null,
      agentType: agent_type,
      skills,
    }, null, 2));

    // Write MEMORY.md stub
    const memoryPath = path.join(WORKSPACE, 'MEMORY.md');
    if (!fs.existsSync(memoryPath)) {
      const memLines = [
        '# MEMORY.md\n',
        companyName ? `## Company\n${companyName}\n` : '',
        `## Focus\n${focusArea || 'General'}\n`,
        `## Language\n${language || 'English'}\n`,
        `## Agent Type\n${agent_type}\n`,
      ].join('\n');
      fs.writeFileSync(memoryPath, memLines, 'utf8');
    }

    // Determine redirect — send to panel after onboarding
    const redirect = POST_ONBOARD_URL;

    res.json({
      ok: true,
      redirect,
      agentType: agent_type,
      introMessage: intro_message,
      skills,
    });
  } catch (err) {
    console.error('[onboarding/one-shot] File write error:', err.message);
    res.status(500).json({ error: 'Failed to save agent configuration.' });
  }
}
