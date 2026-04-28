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
import re

def try_scrapling(url: str) -> dict:
    """Attempt Scrapling + Playwright stealth scrape."""
    try:
        import asyncio
        from scrapling.playwright import AsyncStealthBrowser

        async def _scrape():
            browser = AsyncStealthBrowser(headless=True)
            page = await browser.new_page()
            await page.goto(url, timeout=20000, wait_until="domcontentloaded")

            import asyncio as _aio
            await _aio.sleep(2)

            og_title = await page.evaluate(
                'document.querySelector(\'meta[property="og:title"]\')?.content || ""'
            )
            og_desc = await page.evaluate(
                'document.querySelector(\'meta[property="og:description"]\')?.content || ""'
            )
            body_text = await page.evaluate("""
                Array.from(document.querySelectorAll(
                    'h1, h2, .text-heading-xlarge, .pv-text-details__left-panel, '
                    + '.ph5, .core-section-container__content, '
                    + '[data-generated-suggestion-target], .artdeco-card'
                ))
                .map(el => el.innerText?.trim())
                .filter(t => t && t.length > 3)
                .slice(0, 20)
                .join('\\n')
            """)
            await page.close()

            parts = [p for p in [og_title, og_desc, body_text] if p and len(p) > 3]
            combined = "\n".join(parts)
            combined = re.sub(r'\s{3,}', '\n', combined).strip()

            if len(combined) < 30:
                return {"ok": False, "error": "LinkedIn returned too little data (login wall likely)"}
            source_type = "linkedin-company" if "/company/" in url else "linkedin-profile"
            return {"ok": True, "text": combined[:4000], "sourceType": source_type}

        return asyncio.run(_scrape())
    except ImportError:
        return {"ok": False, "error": "scrapling not installed — skipping Playwright scrape"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def try_fetch(url: str) -> dict:
    """Basic urllib fetch for og:meta tags (no browser needed)."""
    try:
        import urllib.request
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; WiseChef/1.0)',
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode('utf-8', errors='replace')

        og_title = re.search(r'<meta\s+property="og:title"\s+content="([^"]*)"', html)
        og_desc  = re.search(r'<meta\s+property="og:description"\s+content="([^"]*)"', html)
        parts = []
        if og_title and len(og_title.group(1)) > 3:
            parts.append(og_title.group(1))
        if og_desc and len(og_desc.group(1)) > 3:
            parts.append(og_desc.group(1))

        combined = "\n".join(parts).strip()
        if len(combined) >= 20:
            source_type = "linkedin-company" if "/company/" in url else "linkedin-profile"
            return {"ok": True, "text": combined[:4000], "sourceType": source_type}
        return {"ok": False, "error": "og:meta too sparse"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Usage: linkedin_scrape.py <url>"}))
        sys.exit(2)

    url = sys.argv[1]

    # Validate URL
    if 'linkedin.com' not in url:
        print(json.dumps({"ok": False, "error": "Not a LinkedIn URL"}))
        sys.exit(2)

    # Layer 1: Scrapling (best quality, requires install)
    result = try_scrapling(url)
    if result["ok"]:
        print(json.dumps(result))
        sys.exit(0)

    # Layer 2: Basic fetch og:meta
    result2 = try_fetch(url)
    if result2["ok"]:
        print(json.dumps(result2))
        sys.exit(0)

    # All layers failed — soft failure, caller should use slug fallback
    print(json.dumps({
        "ok": False,
        "error": f"All scrapers failed. Scrapling: {result['error']}. Fetch: {result2['error']}"
    }))
    sys.exit(1)


if __name__ == "__main__":
    main()
