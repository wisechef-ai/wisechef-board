// fix-1-mount-update.js — exempt Chef from agent limits in enterprise-mount.js
const fs = require('fs');
const MOUNT = '/opt/wisechef/board/server/enterprise-mount.js';
let content = fs.readFileSync(MOUNT, 'utf8');
const orig = content;

// Find role === 'ceo' patterns and add Chef exemption
// Pattern 1: role === 'ceo'
content = content.replace(
    /role\s*===\s*'ceo'/g,
    "(role === 'ceo' || body?.name === 'Chef' || body?.title === 'Personal Assistant')"
);
// Pattern 2: role === "ceo"
content = content.replace(
    /role\s*===\s*"ceo"/g,
    '(role === "ceo" || body?.name === "Chef" || body?.title === "Personal Assistant")'
);

if (content !== orig) {
    fs.writeFileSync(MOUNT, content);
    console.log('[fix-1] enterprise-mount.js: Chef exempted from agent limits');
} else {
    console.log('[fix-1] No ceo role check found to update');
}

// Also update the entrypoint Chef upgrade logic to use 'general' role
const ENTRY = '/entrypoint.sh';
let entry = fs.readFileSync(ENTRY, 'utf8');
entry = entry.replace(/role: 'assistant'/g, "role: 'general'");
entry = entry.replace(/role === 'assistant'/g, "role === 'general'");
fs.writeFileSync(ENTRY, entry);
console.log('[fix-1] entrypoint.sh: updated to use general role');
