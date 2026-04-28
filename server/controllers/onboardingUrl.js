/**
 * onboardingUrl.js — URL-to-Agent onboarding controller
 *
 * POST /api/onboarding/scrape-url
 *   { url } → scrape → Claude extraction → structured context JSON
 *
 * Called from the onboarding URL step.
 * Result is shown as a preview to the user before they confirm.
 * Confirmed context is then passed into the one-shot pipeline or
 * stored as USER.md/MEMORY.md pre-fill.
 */

import { scrapeUrl } from '../lib/urlScraper.js';

const VALID_AGENT_TYPES = [
  'generalist', 'marketing', 'executive-assistant',
  'health-coach', 'security-auditor', 'sales-assistant',
];

const EXTRACT_PROMPT = (sourceType, rawText) => `You are an AI context extractor for WiseChef AI onboarding.

A new user has provided their ${sourceType} URL. Here is the text we extracted from it:

---
${rawText}
---

Based on this content, extract structured context and recommend an agent type.

Return ONLY a valid JSON object with these exact fields:
{
  "name": "<person or company name, or null if unclear>",
  "description": "<1-2 sentence summary of who they are and what they do>",
  "industry": "<their industry/sector, e.g. 'e-commerce', 'software development', 'marketing agency'>",
  "tone": "<one of: professional, casual, technical, creative>",
  "agentType": "<one of: generalist, marketing, executive-assistant, health-coach, security-auditor, sales-assistant>",
  "agentReason": "<one sentence: why this agent type fits them>",
  "keyFacts": ["<fact 1>", "<fact 2>", "<fact 3>"]
}

Rules:
- agentType must be exactly one of the listed slugs
- keyFacts: max 3 items, concrete facts from their content (not generic statements)
- If the content is too vague, description should say "I couldn't extract much detail — they can fill in manually"
- Never guess or invent information not present in the text`;

async function callOpenRouter(sourceType, rawText) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://wisechef.ai',
      'X-Title': 'WiseChef URL Onboarding',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-haiku-4.5',
      messages: [{ role: 'user', content: EXTRACT_PROMPT(sourceType, rawText) }],
      max_tokens: 600,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Empty response from model');

  // Extract JSON from possible ```json ... ``` fence
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || content.match(/(\{[\s\S]*\})/);
  const raw = jsonMatch ? jsonMatch[1].trim() : content;
  return JSON.parse(raw);
}

function sanitizeExtraction(parsed) {
  const agentType = VALID_AGENT_TYPES.includes(parsed.agentType) ? parsed.agentType : 'generalist';
  return {
    name: typeof parsed.name === 'string' ? parsed.name : null,
    description: typeof parsed.description === 'string' ? parsed.description : '',
    industry: typeof parsed.industry === 'string' ? parsed.industry : '',
    tone: ['professional', 'casual', 'technical', 'creative'].includes(parsed.tone) ? parsed.tone : 'professional',
    agentType,
    agentReason: typeof parsed.agentReason === 'string' ? parsed.agentReason : '',
    keyFacts: Array.isArray(parsed.keyFacts) ? parsed.keyFacts.slice(0, 3).filter(f => typeof f === 'string') : [],
  };
}

/**
 * POST /api/onboarding/scrape-url
 * Body: { url: string }
 * Returns: { ok, sourceType, extracted: { name, description, industry, tone, agentType, agentReason, keyFacts } }
 */
export async function scrapeUrlHandler(req, res) {
  const { url } = req.body;
  if (!url || typeof url !== 'string' || url.trim().length < 4) {
    return res.status(400).json({ error: 'Please provide a valid URL.' });
  }

  let scraped;
  try {
    scraped = await scrapeUrl(url.trim());
  } catch (err) {
    console.error('[onboarding/scrape-url] Scrape error:', err.message);
    // Return a user-friendly error — frontend will offer fallback to manual
    return res.status(422).json({
      error: err.message.startsWith('That doesn\'t') ? err.message
        : 'Couldn\'t read that URL — it may be private or slow to load. You can fill in your details manually instead.',
      fallback: true,
    });
  }

  let extracted;
  try {
    const raw = await callOpenRouter(scraped.sourceType, scraped.rawText);
    extracted = sanitizeExtraction(raw);
  } catch (err) {
    console.error('[onboarding/scrape-url] Extraction error:', err.message);
    // Scrape succeeded but Claude failed — still return raw scrape data
    extracted = {
      name: scraped.githubName || null,
      description: scraped.rawText.slice(0, 200),
      industry: '',
      tone: 'professional',
      agentType: 'generalist',
      agentReason: 'Default — extraction failed',
      keyFacts: [],
    };
  }

  res.json({
    ok: true,
    sourceType: scraped.sourceType,
    url: scraped.url,
    extracted,
    linkedInWall: scraped.linkedInWall || false,  // scrape was partial — frontend shows manual-entry prompt
  });
}
