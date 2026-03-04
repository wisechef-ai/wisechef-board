/**
 * urlScraper.js — URL detection + scraping for onboarding
 *
 * Supported sources:
 *   website   — any https:// URL (company site, personal site)
 *   linkedin  — linkedin.com/in/<user> or linkedin.com/company/<slug>
 *   github    — github.com/<username>
 *   instagram — instagram.com/<handle>
 *
 * Returns structured JSON or throws with a user-visible message.
 */

import * as cheerio from 'cheerio';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_TEXT_CHARS = 4000; // cap text before sending to Claude

// ── URL type detection ────────────────────────────────────────────────────────

export function detectUrlType(rawUrl) {
  let url;
  try {
    // Normalize — add https:// if missing
    const normalized = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    url = new URL(normalized);
  } catch {
    return { type: 'invalid', url: null };
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const path = url.pathname.toLowerCase();

  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
    if (path.startsWith('/in/')) return { type: 'linkedin-profile', url: url.href };
    if (path.startsWith('/company/')) return { type: 'linkedin-company', url: url.href };
    return { type: 'linkedin-profile', url: url.href };
  }
  if (host === 'github.com') {
    const username = url.pathname.replace(/^\//, '').split('/')[0];
    if (username && !username.startsWith('.')) {
      return { type: 'github', url: url.href, username };
    }
  }
  if (host === 'instagram.com') {
    return { type: 'instagram', url: url.href };
  }

  return { type: 'website', url: url.href };
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; WiseChef-Agent/1.0; +https://wisechef.ai)',
      'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('html') && !ct.includes('text')) {
    throw new Error(`Non-HTML response from ${url}: ${ct}`);
  }
  return res.text();
}

// Extract readable text from HTML — title, meta, headings, body paragraphs
function extractTextFromHtml(html) {
  const $ = cheerio.load(html);

  // Remove noise
  $('script, style, nav, footer, header, noscript, [aria-hidden="true"]').remove();

  const title = $('title').first().text().trim();
  const metaDesc = $('meta[name="description"]').attr('content')
    || $('meta[property="og:description"]').attr('content')
    || '';
  const ogTitle = $('meta[property="og:title"]').attr('content') || '';
  const ogSiteName = $('meta[property="og:site_name"]').attr('content') || '';

  const h1 = $('h1').first().text().trim();
  const h2s = $('h2').map((_, el) => $(el).text().trim()).get().slice(0, 5).join(' | ');

  // Main body text — prefer main/article/section, fall back to body
  const bodyEl = $('main, article, [role="main"], section').first();
  const bodyText = (bodyEl.length ? bodyEl : $('body'))
    .find('p')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(t => t.length > 30)
    .slice(0, 15)
    .join('\n');

  const combined = [ogSiteName, ogTitle || title, metaDesc, h1, h2s, bodyText]
    .filter(Boolean)
    .join('\n')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_TEXT_CHARS);

  return { title: ogTitle || title, metaDesc, combined };
}

// ── Source-specific scrapers ──────────────────────────────────────────────────

async function scrapeWebsite(url) {
  const html = await fetchHtml(url);
  const { title, metaDesc, combined } = extractTextFromHtml(html);
  return {
    sourceType: 'website',
    url,
    rawText: combined,
    hint: `Website: ${title}. Meta: ${metaDesc}`,
  };
}

async function scrapeLinkedIn(url, type) {
  // LinkedIn is JS-rendered — most content is gated.
  // We can reliably get: og:title, og:description, og:image alt text.
  const html = await fetchHtml(url).catch(() => null);

  let rawText = '';
  if (html) {
    const $ = cheerio.load(html);
    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    const ogDesc = $('meta[property="og:description"]').attr('content') || '';
    const title = $('title').text().trim();
    rawText = [ogTitle, ogDesc, title].filter(Boolean).join('\n');
  }

  if (!rawText || rawText.length < 20) {
    // Graceful fallback — return URL only and let Claude infer from the URL slug
    const slug = url.split('/').filter(Boolean).pop();
    rawText = `LinkedIn ${type === 'linkedin-profile' ? 'profile' : 'company page'}: ${slug} (${url})`;
  }

  return { sourceType: type, url, rawText, hint: 'LinkedIn (limited HTML — og:meta extracted)' };
}

async function scrapeGitHub(url, username) {
  // GitHub public API — no auth required
  const [userRes, reposRes] = await Promise.allSettled([
    fetch(`https://api.github.com/users/${username}`, {
      headers: { 'User-Agent': 'WiseChef-Agent/1.0' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }),
    fetch(`https://api.github.com/users/${username}/repos?per_page=6&sort=pushed`, {
      headers: { 'User-Agent': 'WiseChef-Agent/1.0' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }),
  ]);

  let profile = {};
  let repos = [];

  if (userRes.status === 'fulfilled' && userRes.value.ok) {
    profile = await userRes.value.json();
  }
  if (reposRes.status === 'fulfilled' && reposRes.value.ok) {
    const r = await reposRes.value.json();
    if (Array.isArray(r)) {
      repos = r.filter(repo => !repo.fork).slice(0, 5).map(repo => ({
        name: repo.name,
        description: repo.description || '',
        language: repo.language || '',
        stars: repo.stargazers_count,
      }));
    }
  }

  const topLangs = [...new Set(repos.map(r => r.language).filter(Boolean))].slice(0, 4);
  const repoList = repos.map(r => `${r.name}${r.description ? ': ' + r.description : ''}`).join('; ');

  const rawText = [
    profile.name ? `Name: ${profile.name}` : '',
    profile.login ? `GitHub: @${profile.login}` : '',
    profile.bio ? `Bio: ${profile.bio}` : '',
    profile.company ? `Company: ${profile.company}` : '',
    profile.location ? `Location: ${profile.location}` : '',
    topLangs.length ? `Primary languages: ${topLangs.join(', ')}` : '',
    repoList ? `Recent repos: ${repoList}` : '',
    profile.public_repos ? `Public repos: ${profile.public_repos}` : '',
  ].filter(Boolean).join('\n');

  if (!rawText) throw new Error(`GitHub user @${username} not found or has no public data`);

  return { sourceType: 'github', url, rawText, hint: 'GitHub public API', githubName: profile.name || username };
}

async function scrapeInstagram(url) {
  // Instagram is heavily JS-rendered. Best we can get: og:meta from the HTML.
  const html = await fetchHtml(url).catch(() => null);

  let rawText = '';
  if (html) {
    const $ = cheerio.load(html);
    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    const ogDesc = $('meta[property="og:description"]').attr('content') || '';
    rawText = [ogTitle, ogDesc].filter(Boolean).join('\n');
  }

  if (!rawText || rawText.length < 10) {
    const handle = url.split('/').filter(Boolean).pop();
    rawText = `Instagram profile: @${handle} (${url}) — limited data from public HTML`;
  }

  return { sourceType: 'instagram', url, rawText, hint: 'Instagram (og:meta only)' };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Scrape a URL and return structured raw data for Claude extraction.
 * @param {string} rawUrl — URL or domain typed by the user
 * @returns {{ sourceType, url, rawText, hint, ... }}
 */
export async function scrapeUrl(rawUrl) {
  const detected = detectUrlType(rawUrl);

  if (detected.type === 'invalid') {
    throw new Error('That doesn\'t look like a valid URL. Try something like https://yourcompany.com');
  }

  switch (detected.type) {
    case 'website':
      return scrapeWebsite(detected.url);
    case 'linkedin-profile':
    case 'linkedin-company':
      return scrapeLinkedIn(detected.url, detected.type);
    case 'github':
      return scrapeGitHub(detected.url, detected.username);
    case 'instagram':
      return scrapeInstagram(detected.url);
    default:
      return scrapeWebsite(detected.url);
  }
}
