#!/usr/bin/env node
/**
 * run-offline.js — WiseChef offline smoke tests
 * Tests static artifacts (entrypoint, tier-config, sanitizer) without a running container.
 * Run: node run-offline.js
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "../..");
const DOCKER_DIR = path.join(ROOT, "docker");

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

console.log("\n=== WiseChef Offline Smoke Tests ===\n");

// --- Entrypoint ---
console.log("📁 Entrypoint");
const entrypoint = fs.readFileSync(path.join(DOCKER_DIR, "entrypoint.sh"), "utf8");
test("sanitize-config.mjs is called in entrypoint", () =>
  assert(entrypoint.includes("sanitize-config.mjs"), "sanitize-config.mjs not referenced in entrypoint.sh"));
test("WISECHEF_POST_INSTALL_URL is used", () =>
  assert(entrypoint.includes("WISECHEF_POST_INSTALL_URL"), "post-install URL env var not in entrypoint"));
test("device-pair not hardcoded to enabled", () =>
  assert(!entrypoint.match(/device-pair.*enabled.*true/), "device-pair enabled:true found in entrypoint"));
test("COMPANY_PLAN used for tier selection", () =>
  assert(entrypoint.includes("COMPANY_PLAN") || entrypoint.includes("WISECHEF_PLAN"), "no plan selector in entrypoint"));

// --- Sanitizer ---
console.log("\n🧹 Config Sanitizer");
const sanitizer = fs.readFileSync(path.join(DOCKER_DIR, "sanitize-config.mjs"), "utf8");
test("removes devicePairing key", () =>
  assert(sanitizer.includes("devicePairing"), "devicePairing not handled in sanitizer"));
test("removes dangerouslyDisableDeviceAuth", () =>
  assert(sanitizer.includes("dangerouslyDisableDeviceAuth"), "dangerouslyDisableDeviceAuth not handled"));
test("disables device-pair plugin", () =>
  assert(sanitizer.includes("device-pair") && sanitizer.includes("enabled: false"), "device-pair not disabled in sanitizer"));

// --- Tier Config ---
console.log("\n🎯 Tier Config");
const tierConfig = fs.readFileSync(path.join(DOCKER_DIR, "tier-config.js"), "utf8");
test("Pro tier defined", () =>
  assert(tierConfig.includes("pro"), "pro tier missing from tier-config.js"));
test("Enterprise tier defined", () =>
  assert(tierConfig.includes("enterprise"), "enterprise tier missing"));
test("Founder/contractor tier defined", () =>
  assert(tierConfig.includes("founder") || tierConfig.includes("contractor"), "founder tier missing"));
test("Cognee enabled on all tiers", () => {
  // Count cognee: true occurrences
  const count = (tierConfig.match(/cognee.*true/g) || []).length;
  assert(count >= 2, `cognee:true only found ${count} times, expected ≥2`);
});
test("Paperclip enabled on all tiers", () => {
  const count = (tierConfig.match(/paperclip.*true/g) || []).length;
  assert(count >= 2, `paperclip:true only found ${count} times, expected ≥2`);
});
test("Pro has 5 agents", () =>
  assert(tierConfig.match(/pro[\s\S]*?agents.*[45]/), "pro agent count not 4 or 5"));
test("Enterprise has 21 agents", () =>
  assert(tierConfig.includes("21"), "21 agent count not found for enterprise"));
test("Pro uses claude-sonnet", () =>
  assert(tierConfig.includes("claude-sonnet"), "claude-sonnet not in tier-config"));
test("Founder uses codex", () =>
  assert(tierConfig.includes("codex") || tierConfig.includes("gpt-5"), "codex model not in founder tier"));

// --- Post-Install ---
console.log("\n📦 Post-Install");
const postInstall = fs.readFileSync(path.join(DOCKER_DIR, "post-install.sh"), "utf8");
test("Has version string", () =>
  assert(postInstall.match(/VERSION="20\d{2}\.\d/), "no CalVer VERSION in post-install.sh"));
test("Installs Cognee", () =>
  assert(postInstall.includes("cognee"), "cognee install not in post-install.sh"));
test("Installs Scrapling", () =>
  assert(postInstall.includes("scrapling"), "scrapling install not in post-install.sh"));
test("Installs PinchTab", () =>
  assert(postInstall.includes("pinchtab"), "pinchtab install not in post-install.sh"));
test("Config patch removes deprecated keys", () =>
  assert(postInstall.includes("devicePairing") && !postInstall.match(/devicePairing.*=.*true/), "devicePairing cleanup missing"));

// --- Dockerfile ---
console.log("\n🐳 Dockerfile");
const dockerfile = fs.readFileSync(path.join(DOCKER_DIR, "Dockerfile"), "utf8");
test("Uses BuildKit syntax", () =>
  assert(dockerfile.includes("dockerfile:1."), "old dockerfile syntax"));
test("GH_TOKEN not in ARG (uses secret instead)", () =>
  assert(!dockerfile.includes("ARG GH_TOKEN"), "ARG GH_TOKEN leaks token in build logs — use BuildKit secret"));
test("WISECHEF_IMAGE_TAG default present", () =>
  assert(dockerfile.includes("WISECHEF_BOARD_REF") || dockerfile.includes("WISECHEF_BOARD_SHA"), "no board SHA ARG"));

// --- Summary ---
console.log(`\n${"=".repeat(40)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed === 0) {
  console.log("\n✅ ALL CHECKS PASSED");
  process.exit(0);
} else {
  console.log("\n❌ SOME CHECKS FAILED");
  process.exit(1);
}
