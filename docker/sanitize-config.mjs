#!/usr/bin/env node
/**
 * sanitize-config.mjs — Remove deprecated OpenClaw config keys.
 * Run after config generation in entrypoint to prevent startup failures.
 * Version: 2026.04.1
 */
import fs from "fs";

const CFG_PATH = "/root/.openclaw/openclaw.json";

try {
  const cfg = JSON.parse(fs.readFileSync(CFG_PATH, "utf8"));
  const gw = cfg.gateway || {};
  const removed = [];

  // Remove deprecated gateway keys that break new OpenClaw
  for (const key of ["devicePairing", "dangerouslyDisableDeviceAuth", "apiTokens"]) {
    if (key in gw) {
      delete gw[key];
      removed.push(key);
    }
  }

  // Ensure device-pair plugin is disabled (prevents pairing code leak)
  if (!cfg.plugins) cfg.plugins = {};
  if (!cfg.plugins.entries) cfg.plugins.entries = {};
  cfg.plugins.entries["device-pair"] = { enabled: false };

  cfg.gateway = gw;
  fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2));

  if (removed.length) {
    console.log(`[sanitize] Removed deprecated keys: ${removed.join(", ")}`);
  }
  console.log("[sanitize] Config sanitized — device-pair disabled");
} catch (err) {
  console.error("[sanitize] Config sanitization failed (non-fatal):", err.message);
  process.exit(0); // non-fatal
}
