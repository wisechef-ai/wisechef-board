// DRAFTED TEST 3 — critical path: URL→Agent onboarding (wisechef-board server)
//
// WHY THIS PATH IS CRITICAL
// -------------------------
// server/lib/urlScraper.js `detectUrlType()` is the FIRST step of the flagship
// "paste a URL, get an agent" onboarding funnel (POST /api/onboarding/scrape-url
// → urlScraper.scrapeUrl → Claude extraction → one-shot pipeline). The board has
// exactly 5 automated tests and none import server code — measured 2026-09-26,
// real coverage ≈ 0%. A regression in detectUrlType misroutes the whole funnel:
//   - a LinkedIn company URL classified as a generic website loses the
//     extraction hints the LLM prompt depends on,
//   - an invalid URL returning a non-'invalid' type crashes the scraper and
//     surfaces a 500 to the user at the most conversion-sensitive moment
//     (signup → first agent).
//
// WHAT IS TESTED (pure function — no network, runs in `node --test`)
// 1. https URL                          -> { type: 'website' }
// 2. bare domain (scheme added)         -> { type: 'website' }
// 3. linkedin.com/in/x                  -> linkedin-profile
// 4. linkedin.com/company/x             -> linkedin-company
// 5. github.com/user                    -> github + username extracted
// 6. instagram.com/handle               -> instagram
// 7. garbage input                      -> { type: 'invalid', url: null }
//
// Drop-in location: server/lib/urlScraper.test.js  (AGENTS.md convention:
// *.test.js colocated or in tests/; run with `node --test test/`).

import test from 'node:test';
import assert from 'node:assert/strict';
import { detectUrlType } from './urlScraper.js';

test('detectUrlType classifies a plain website URL', () => {
  const r = detectUrlType('https://wisechef.ai');
  assert.equal(r.type, 'website');
  // WHATWG URL normalizes the origin to include the trailing slash
  assert.equal(r.url, 'https://wisechef.ai/');
});

test('detectUrlType normalizes a bare domain by adding https://', () => {
  const r = detectUrlType('example.com');
  assert.equal(r.type, 'website');
  assert.ok(r.url.startsWith('https://'));
});

test('detectUrlType distinguishes linkedin profile vs company', () => {
  assert.equal(detectUrlType('https://www.linkedin.com/in/jan-kowalski').type, 'linkedin-profile');
  assert.equal(detectUrlType('https://linkedin.com/company/wisechef').type, 'linkedin-company');
});

test('detectUrlType extracts github username', () => {
  const r = detectUrlType('https://github.com/adamkrawczyk');
  assert.equal(r.type, 'github');
  assert.equal(r.username, 'adamkrawczyk');
});

test('detectUrlType classifies instagram handles', () => {
  assert.equal(detectUrlType('https://instagram.com/somechef').type, 'instagram');
});

test('detectUrlType returns invalid for garbage instead of throwing', () => {
  const r = detectUrlType('not a url at all :::');
  assert.equal(r.type, 'invalid');
  assert.equal(r.url, null);
});
