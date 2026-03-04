/**
 * workspaceReset.js — Factory Reset controller
 *
 * DELETE /api/workspace/reset          — soft reset (removes onboarding sentinels)
 * DELETE /api/workspace/reset?full=true — full reset (also removes SOUL.md + MEMORY.md)
 *
 * Soft reset: user re-runs onboarding, keeping their SOUL.md intact.
 * Full reset: complete wipe — blank slate, as if freshly provisioned.
 */

import fs from 'fs';
import path from 'path';
import { WORKSPACE } from '../config.js';

// Files always deleted on reset (onboarding sentinels)
const SENTINEL_FILES = [
  'onboarding-complete.json',
  'agent-type.json',
];

// Additional files deleted only on full reset
const FULL_RESET_FILES = [
  'SOUL.md',
  'MEMORY.md',
];

function safeDelete(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (err) {
    console.error(`[factory-reset] Failed to delete ${filePath}:`, err.message);
  }
  return false;
}

/**
 * DELETE /api/workspace/reset
 * Query: ?full=true  → also wipe SOUL.md + MEMORY.md
 */
export function factoryReset(req, res) {
  const full = req.query.full === 'true';
  const deleted = [];
  const skipped = [];

  const targets = full
    ? [...SENTINEL_FILES, ...FULL_RESET_FILES]
    : SENTINEL_FILES;

  for (const filename of targets) {
    const filePath = path.join(WORKSPACE, filename);
    if (safeDelete(filePath)) {
      deleted.push(filename);
    } else {
      skipped.push(filename);
    }
  }

  console.log(`[factory-reset] Reset complete. Deleted: [${deleted.join(', ')}] Skipped: [${skipped.join(', ')}]`);

  res.json({
    success: true,
    full,
    deleted,
    skipped,
    redirect: '/onboarding',
  });
}
