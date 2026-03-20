import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Paperclip integration avoids eager embedded server import', () => {
  const source = fs.readFileSync('server/lib/paperclip.js', 'utf8');
  assert.ok(!source.includes("import { createServer } from '@paperclipai/server';"));
  assert.ok(source.includes('PAPERCLIP_MODE'));
  assert.ok(source.includes('external surface detected'));
});

test('Docker build requires explicit SHAs for reproducible private inputs', () => {
  const source = fs.readFileSync('docker/Dockerfile', 'utf8');
  assert.ok(source.includes('ARG WISECHEF_BOARD_SHA'));
  assert.ok(source.includes('git checkout --detach "$WISECHEF_BOARD_SHA"'));
  assert.ok(source.includes('ARG WISECHEF_ENTERPRISE_SHA'));
  assert.ok(source.includes('ARG WISECHEF_ENTERPRISE_PANEL_SHA'));
  assert.ok(source.includes('wisechef-enterprise-panel.git'));
  assert.ok(!source.includes('COPY enterprise-panel-bundle'));
});

test('Onboarding limits match PA plus company-agent packaging', () => {
  const source = fs.readFileSync('server/controllers/onboardingUnified.js', 'utf8');
  assert.ok(source.includes('starter: 1'));
  assert.ok(source.includes('pro: 5'));
  assert.ok(source.includes('enterprise: 21'));
});

test('Enterprise plan endpoint reports team-agent limits', () => {
  const source = fs.readFileSync('server/enterprise-mount.js', 'utf8');
  assert.ok(source.includes('teamAgentLimit'));
  assert.ok(source.includes('teamAgentsUsed'));
  assert.ok(source.includes('companyAgents'));
});

test('Nightly self-improvement scaffolding is shipped in the image', () => {
  const dockerfile = fs.readFileSync('docker/Dockerfile', 'utf8');
  const entrypoint = fs.readFileSync('docker/entrypoint.sh', 'utf8');
  const nightly = fs.readFileSync('docker/nightly-self-improve.sh', 'utf8');
  assert.ok(dockerfile.includes('cron'));
  assert.ok(dockerfile.includes('docker/nightly-self-improve.sh'));
  assert.ok(dockerfile.includes('docker/cognee'));
  assert.ok(entrypoint.includes('/etc/cron.d/wisechef-nightly'));
  assert.ok(entrypoint.includes('nightly-self-improve.sh'));
  assert.ok(nightly.includes('scripts/autoresearch.sh'));
  assert.ok(nightly.includes('nightly-sync.sh'));
});
