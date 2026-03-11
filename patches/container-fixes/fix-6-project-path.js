// Fix Issue 6: Intercept project creation in enterprise-mount.js
// Auto-generate workspace path when localPath is not provided
// User just enters project name — we create /opt/wisechef/workspace/projects/<slug>

const fs = require('fs');

const MOUNT_JS = '/opt/wisechef/board/server/enterprise-mount.js';
let content = fs.readFileSync(MOUNT_JS, 'utf8');
const original = content;

// Add project workspace auto-creation interceptor before the generic API proxy
const interceptor = `
  // Issue 6: Auto-generate workspace path for project creation
  app.post('/enterprise/api/companies/:companyId/projects', express.json(), (req, res, next) => {
    const body = req.body || {};
    // If workspace is provided but has no cwd, auto-generate one
    if (body.workspace && !body.workspace.cwd) {
      const slug = (body.name || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const projectDir = '/opt/wisechef/workspace/projects/' + slug;
      try { require('fs').mkdirSync(projectDir, { recursive: true }); } catch {}
      body.workspace.cwd = projectDir;
      req.body = body;
    }
    // If no workspace at all, create a default one
    if (!body.workspace) {
      const slug = (body.name || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const projectDir = '/opt/wisechef/workspace/projects/' + slug;
      try { require('fs').mkdirSync(projectDir, { recursive: true }); } catch {}
      body.workspace = { name: body.name || 'Workspace', cwd: projectDir, isPrimary: true };
      req.body = body;
    }
    next();
  });

  // Issue 6: Also intercept workspace creation on existing projects
  app.post('/enterprise/api/projects/:id/workspaces', express.json(), (req, res, next) => {
    const body = req.body || {};
    if (!body.cwd) {
      const slug = (body.name || 'workspace').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const wsDir = '/opt/wisechef/workspace/projects/' + slug;
      try { require('fs').mkdirSync(wsDir, { recursive: true }); } catch {}
      body.cwd = wsDir;
      req.body = body;
    }
    next();
  });
`;

// Insert before the generic `app.all('/enterprise/api/*', proxyRequest);` line
const insertBefore = "  // API proxy — all /enterprise/api/* → Paperclip";
if (content.includes(insertBefore)) {
    content = content.replace(insertBefore, interceptor + '\n' + insertBefore);
    console.log('[fix-6] Added project workspace auto-creation interceptor');
} else {
    console.error('[fix-6] Could not find insertion point in enterprise-mount.js');
}

if (content !== original) {
    fs.writeFileSync(MOUNT_JS, content);
    console.log('[fix-6] enterprise-mount.js updated');
} else {
    console.log('[fix-6] No changes applied');
}
