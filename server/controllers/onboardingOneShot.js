import fs from 'fs';
import path from 'path';
import { WORKSPACE, AGENT_TYPES_ENABLED } from '../config.js';

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

const VALID_TYPES = ['generalist', 'marketing', 'executive-assistant', 'health-coach', 'security-auditor', 'sales-assistant'];

const GENERATION_PROMPT = (userInput) => `You are configuring a personal AI assistant for WiseChef AI.

User description: "${userInput}"

Based on this description, generate a complete agent configuration. Be specific and personal — use details from their description.

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
  "soul_md": "<full SOUL.md content as a string — minimum 200 words, personalised to their description>",
  "skills": ["<skill-slug>", ...],
  "intro_message": "<warm, personal first message from the agent. Reference their description. Ask one clarifying question. 2-4 sentences.>"
}

For soul_md, write a complete SOUL.md that includes:
- # SOUL.md — [their name or role]
- ## Identity (name, role, personality)
- ## Communication Style (direct, warm, formal, etc. — inferred from their tone)
- ## Priorities (what matters most to them based on their description)
- ## How I Work (their work style, hours if mentioned, tools)
- ## What I Avoid (inferred dislikes or time-wasters for their role)

For skills, choose from: ["larry", "google-workspace", "healthcheck", "proactive-agent", "summarize"]
Only include skills that genuinely fit their use case.`;

async function callOpenRouter(userInput) {
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
      model: 'anthropic/claude-sonnet-4.6',
      messages: [{ role: 'user', content: GENERATION_PROMPT(userInput) }],
      max_tokens: 1500,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Empty response from model');

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
  const { userInput } = req.body;
  if (!userInput || typeof userInput !== 'string' || userInput.trim().length < 5) {
    return res.status(400).json({ error: 'Please describe yourself in at least a few words.' });
  }

  try {
    const raw = await callOpenRouter(userInput.trim());
    const result = validateAndSanitize(raw);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[onboarding/generate] Error:', err.message);
    res.status(500).json({ error: 'Failed to generate agent configuration. Please try again.' });
  }
}

/**
 * POST /api/onboarding/one-shot
 * Full pipeline: generate → write files → mark onboarding complete.
 * Body: { userInput: string }
 */
export async function oneShotOnboarding(req, res) {
  const { userInput } = req.body;
  if (!userInput || typeof userInput !== 'string' || userInput.trim().length < 5) {
    return res.status(400).json({ error: 'Please describe yourself in at least a few words.' });
  }

  let result;
  try {
    const raw = await callOpenRouter(userInput.trim());
    result = validateAndSanitize(raw);
  } catch (err) {
    console.error('[onboarding/one-shot] Generation error:', err.message);
    return res.status(500).json({ error: 'Failed to generate agent configuration. Please try again.' });
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
      userInput: userInput.trim(),
      agentType: agent_type,
      skills,
    }, null, 2));

    // Write MEMORY.md stub
    const memoryPath = path.join(WORKSPACE, 'MEMORY.md');
    if (!fs.existsSync(memoryPath)) {
      fs.writeFileSync(memoryPath, `# MEMORY.md\n\n## About Me\n${userInput.trim()}\n\n## Agent Type\n${agent_type}\n`, 'utf8');
    }

    // Determine redirect — channel linking stays separate
    const redirect = '/';

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
