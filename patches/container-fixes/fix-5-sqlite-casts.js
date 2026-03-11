// Fix Issue 5: Patch activity.js and costs.js to replace PostgreSQL ::text with SQLite-compatible CAST
// SQLite doesn't support ::text cast syntax. Replace with CAST(x AS TEXT) via sql template.

const fs = require('fs');

const fixes = [
    {
        file: '/opt/wisechef/enterprise-panel/server/dist/services/activity.js',
        from: "const issueIdAsText = sql `${issues.id}::text`;",
        to:   "const issueIdAsText = sql `CAST(${issues.id} AS TEXT)`;",
    },
    {
        file: '/opt/wisechef/enterprise-panel/server/dist/services/costs.js',
        search: /\$\{issues\.id\}::text/g,
        replace: "CAST(${issues.id} AS TEXT)",
    },
];

let allOk = true;

for (const fix of fixes) {
    try {
        let content = fs.readFileSync(fix.file, 'utf8');
        const original = content;
        
        if (fix.from) {
            if (!content.includes(fix.from)) {
                // Check if already fixed
                if (content.includes(fix.to)) {
                    console.log(`[fix-5] ${fix.file}: already patched`);
                    continue;
                }
                console.error(`[fix-5] ${fix.file}: could not find target string`);
                allOk = false;
                continue;
            }
            content = content.replace(fix.from, fix.to);
        } else if (fix.search) {
            content = content.replace(fix.search, fix.replace);
        }
        
        if (content === original) {
            console.log(`[fix-5] ${fix.file}: no changes needed (already patched?)`);
        } else {
            fs.writeFileSync(fix.file, content);
            console.log(`[fix-5] ${fix.file}: patched`);
        }
    } catch (e) {
        console.error(`[fix-5] ${fix.file}: error — ${e.message}`);
        allOk = false;
    }
}

if (allOk) {
    console.log('[fix-5] All PostgreSQL casts replaced with SQLite-compatible CAST()');
} else {
    console.error('[fix-5] Some patches failed');
    process.exit(1);
}
