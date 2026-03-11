// Fix Issue 2: Routes.js — make channel linking truly optional
// The routes check `hasLinkedChannel() && !req.query.skip` but:
// 1. The skip link goes to /dashboard (doesn't exist as a route — falls through to SPA catch-all)
// 2. The SPA catch-all ALSO checks hasLinkedChannel without skip
// Fix: Once onboarded, always serve the SPA. Channel linking is offered but not required.

const fs = require('fs');

const ROUTES_JS = '/opt/wisechef/board/server/routes.js';
let content = fs.readFileSync(ROUTES_JS, 'utf8');
const original = content;

// Replace the root route: remove hasLinkedChannel gate entirely
const oldRootRoute = `router.get('/', (req, res) => {
  if (!isOnboarded()) {
    return res.sendFile(path.join(__dirname, 'pages', 'onboarding-unified.html'));
  }
  if (!hasLinkedChannel() && !req.query.skip) {
    // When agent types are enabled, show picker before channel linking.
    // Check sentinel — if no type picked yet, redirect to picker first.
    if (AGENT_TYPES_ENABLED && readAgentTypeSentinel) {
      const sentinel = readAgentTypeSentinel();
      if (!sentinel) {
        return res.redirect('/select-agent');
      }
    }
    return res.sendFile(path.join(__dirname, 'pages', 'link-channel.html'));
  }
  // Onboarded + linked (or skip) → serve the board SPA
  return res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});`;

const newRootRoute = `router.get('/', (req, res) => {
  if (!isOnboarded()) {
    return res.sendFile(path.join(__dirname, 'pages', 'onboarding-unified.html'));
  }
  // Show channel linking page once after onboarding (unless skipped or already linked)
  if (!hasLinkedChannel() && !req.query.skip && !req.cookies?.channelLinkShown) {
    if (AGENT_TYPES_ENABLED && readAgentTypeSentinel) {
      const sentinel = readAgentTypeSentinel();
      if (!sentinel) {
        return res.redirect('/select-agent');
      }
    }
    // Set cookie so we only show it once per browser session
    res.cookie('channelLinkShown', '1', { maxAge: 365 * 24 * 60 * 60 * 1000 });
    return res.sendFile(path.join(__dirname, 'pages', 'link-channel.html'));
  }
  // Onboarded → serve the board SPA (channel linking is optional)
  return res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});`;

if (content.includes(oldRootRoute)) {
    content = content.replace(oldRootRoute, newRootRoute);
    console.log('[fix-2] Patched root route — channel linking now optional');
} else {
    console.error('[fix-2] Could not find root route block');
}

// Replace the SPA fallback similarly
const oldFallback = `router.get('*', (req, res) => {
  if (!isOnboarded()) {
    return res.sendFile(path.join(__dirname, 'pages', 'onboarding-unified.html'));
  }
  if (!hasLinkedChannel() && !req.query.skip) {
    if (AGENT_TYPES_ENABLED && readAgentTypeSentinel) {
      const sentinel = readAgentTypeSentinel();
      if (!sentinel) {
        return res.redirect('/select-agent');
      }
    }
    return res.sendFile(path.join(__dirname, 'pages', 'link-channel.html'));
  }
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});`;

const newFallback = `router.get('*', (req, res) => {
  if (!isOnboarded()) {
    return res.sendFile(path.join(__dirname, 'pages', 'onboarding-unified.html'));
  }
  // Serve SPA for all routes once onboarded (channel linking is optional)
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});`;

if (content.includes(oldFallback)) {
    content = content.replace(oldFallback, newFallback);
    console.log('[fix-2] Patched SPA fallback — no more channel linking gate');
} else {
    console.error('[fix-2] Could not find SPA fallback block');
}

// Add cookie-parser import if not present (needed for channelLinkShown cookie)
if (!content.includes('cookie-parser') && !content.includes('cookieParser')) {
    // The cookie check is simple enough — use req.headers.cookie manually instead
    // Replace res.cookie/req.cookies with header-based approach to avoid adding dependency
    content = content.replace(
        "!req.cookies?.channelLinkShown",
        "!(req.headers.cookie || '').includes('channelLinkShown=1')"
    );
    content = content.replace(
        "res.cookie('channelLinkShown', '1', { maxAge: 365 * 24 * 60 * 60 * 1000 });",
        "res.setHeader('Set-Cookie', 'channelLinkShown=1; Path=/; Max-Age=31536000');"
    );
    console.log('[fix-2] Using raw cookie headers (no cookie-parser needed)');
}

// Also add /dashboard redirect route
if (!content.includes("router.get('/dashboard'")) {
    const insertBefore = "// SPA fallback";
    if (content.includes(insertBefore)) {
        content = content.replace(insertBefore, `// Dashboard redirect — supports skip link from channel page
router.get('/dashboard', (req, res) => {
  res.redirect('/?skip=1');
});

${insertBefore}`);
        console.log('[fix-2] Added /dashboard redirect route');
    }
}

if (content !== original) {
    fs.writeFileSync(ROUTES_JS, content);
    console.log('[fix-2] routes.js updated');
} else {
    console.log('[fix-2] No changes applied to routes.js');
}
