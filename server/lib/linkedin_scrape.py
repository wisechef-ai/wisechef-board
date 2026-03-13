#!/usr/bin/env python3
"""
linkedin_scrape.py — Scrapling-powered LinkedIn scraper for WiseChef onboarding.

Usage:
    python3 linkedin_scrape.py <url>

Output:
    JSON to stdout:  { "ok": true, "text": "...", "sourceType": "linkedin-profile" }
    or:              { "ok": false, "error": "..." }

Exit codes:
    0 — success (text extracted)
    1 — soft failure (empty / blocked) — caller should use URL-slug fallback
    2 — hard failure (bad URL, crash)
"""

import sys
import json
import asyncio
import re

async def scrape_linkedin(url: str) -> dict:
    try:
        from scrapling.playwright import AsyncStealthBrowser

        browser = AsyncStealthBrowser(headless=True)
        page = await browser.new_page()

        # LinkedIn sometimes redirects to login wall — accept it, grab what's there
        await page.goto(url, timeout=20000, wait_until="domcontentloaded")
        await asyncio.sleep(2)  # let JS settle

        # Try to grab visible text from the page
        title = await page.title()

        # OG meta fallback
        og_title = await page.evaluate(
            "document.querySelector('meta[property=\"og:title\"]')?.content || ''"
        )
        og_desc = await page.evaluate(
            "document.querySelector('meta[property=\"og:description\"]')?.content || ''"
        )

        # Grab main visible text (name, headline, about)
        body_text = await page.evaluate("""
            Array.from(document.querySelectorAll(
                'h1, h2, .text-heading-xlarge, .pv-text-details__left-panel, ' +
                '.ph5, .core-section-container__content, ' +
                '[data-generated-suggestion-target], .artdeco-card'
            ))
            .map(el => el.innerText?.trim())
            .filter(t => t && t.length > 3)
            .slice(0, 20)
            .join('\\n')
        """)

        await page.close()

        parts = [p for p in [og_title, og_desc, body_text, title] if p and len(p) > 3]
        combined = "\n".join(parts)

        # Strip repeated whitespace
        combined = re.sub(r'\s{3,}', '\n', combined).strip()

        if len(combined) < 30:
            return {"ok": False, "error": "LinkedIn returned login wall — too little data extracted"}

        source_type = "linkedin-company" if "/company/" in url else "linkedin-profile"
        return {"ok": True, "text": combined[:4000], "sourceType": source_type}

    except Exception as e:
        return {"ok": False, "error": str(e)}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Usage: linkedin_scrape.py <url>"}))
        sys.exit(2)

    url = sys.argv[1]
    result = asyncio.run(scrape_linkedin(url))
    print(json.dumps(result))
    sys.exit(0 if result["ok"] else 1)


if __name__ == "__main__":
    main()
