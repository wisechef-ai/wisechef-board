import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { __dirname } from './config.js';

import { getActivity, getTime } from './controllers/activity.js';
import {
  listTasks, createTask, updateTask, reorderTasks,
  runTask, getTaskQueue, pickupTask, completeTask, deleteTask, bulkDeleteTasks,
  getCalendar, getRunHistory, toggleSchedule, getCapacity, reportStatusCheck, getCompletionRate,
} from './controllers/tasks.js';
import { getUsage, getCurrentMonthUsage } from './controllers/usage.js';
import { getOpenclawVersion, updateOpenclaw } from './controllers/openclaw.js';
import { listModels, setModel, getHeartbeat, postHeartbeat } from './controllers/models.js';
import { listSkills, toggleSkill, createSkill, getSkillContent, deleteSkill } from './controllers/skills.js';
import { listFiles, getFileContent, downloadFile, getWorkspaceFile, putWorkspaceFile, getWorkspaceFileHistory } from './controllers/files.js';
import { getSoul, putSoul, getSoulHistory, revertSoul, getSoulTemplates } from './controllers/soul.js';
import { getSettings, postSettings } from './controllers/settings.js';
import { getBoardVersion, updateBoard } from './controllers/vidclaw.js';
import { listCredentials, putCredential, deleteCredential } from './controllers/credentials.js';
import { createChatSession, sendChatMessage } from './controllers/chat.js';
import { getUsageLimits } from './middleware/usageGuard.js';
import { listAgents, agentsStatus, updateAgent } from './controllers/agents.js';
import {
  isOnboarded, hasLinkedChannel,
  getOnboardingStatus, completeOnboarding,
  listChannels, startLinking, getQrStatus, submitToken, unlinkChannel,
  gatewayRestart, gatewayStatus,
} from './controllers/channels.js';
import { oneShotOnboarding, generateOnboarding } from './controllers/onboardingOneShot.js';
import { unifiedOnboarding, getOnboardingRoles, getOnboardingTier } from './controllers/onboardingUnified.js';
import { scrapeUrlHandler } from './controllers/onboardingUrl.js';
import { getPlanoStatus, startPlano, stopPlano, getPlanoConfig, putPlanoConfig } from './controllers/plano.js';
import { startHealthChecks, getFleet, getClientStatus, deployClient } from './controllers/fleet.js';

const router = Router();

// ──── Onboarding & Channel Linking Pages ────

// Onboarding pages served as static HTML (before SPA takes over)
router.get('/onboarding', (_req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'onboarding-unified.html'));
});

router.get('/link', (_req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'link-channel.html'));
});

// ──── Onboarding API ────
router.get('/api/onboarding/status', getOnboardingStatus);
router.post('/api/onboarding/complete', completeOnboarding);
router.get('/api/onboarding/roles', getOnboardingRoles);
router.get('/api/onboarding/tier', getOnboardingTier);
router.post('/api/onboarding/one-shot', oneShotOnboarding);
router.post('/api/onboarding/generate', generateOnboarding);
router.post('/api/onboarding/unified', unifiedOnboarding);
router.post('/api/onboarding/scrape-url', scrapeUrlHandler);

// ──── Channel Management API ────
router.get('/api/channels', listChannels);
router.post('/api/channels/link', startLinking);
router.get('/api/channels/qr/:channel', getQrStatus);
router.post('/api/channels/token', submitToken);
router.delete('/api/channels/:channel', unlinkChannel);

// ──── Gateway Management API ────
router.post('/api/gateway/restart', gatewayRestart);
router.get('/api/gateway/status', gatewayStatus);

// Activity
router.get('/api/activity', getActivity);
router.get('/api/time', getTime);

// Tasks
router.get('/api/tasks', listTasks);
router.post('/api/tasks', createTask);
router.put('/api/tasks/:id', updateTask);
router.post('/api/tasks/reorder', reorderTasks);
router.post('/api/tasks/:id/run', runTask);
router.get('/api/tasks/queue', getTaskQueue);
router.get('/api/tasks/capacity', getCapacity);
router.get('/api/tasks/completion-rate', getCompletionRate);
router.post('/api/tasks/:id/pickup', pickupTask);
router.post('/api/tasks/:id/complete', completeTask);
router.post('/api/tasks/:id/status-check', reportStatusCheck);
router.get('/api/tasks/:id/history', getRunHistory);
router.post('/api/tasks/:id/schedule-toggle', toggleSchedule);
router.delete('/api/tasks/:id', deleteTask);
router.post('/api/tasks/bulk-delete', bulkDeleteTasks);
router.get('/api/calendar', getCalendar);

// Usage
router.get('/api/usage', getUsage);
router.get('/api/usage/current-month', getCurrentMonthUsage);

// OpenClaw
router.get('/api/openclaw/version', getOpenclawVersion);
router.post('/api/openclaw/update', updateOpenclaw);

// Models & Heartbeat
router.get('/api/models', listModels);
router.post('/api/model', setModel);
router.get('/api/heartbeat', getHeartbeat);
router.post('/api/heartbeat', postHeartbeat);

// Skills
router.get('/api/skills', listSkills);
router.post('/api/skills/:id/toggle', toggleSkill);
router.post('/api/skills/create', createSkill);
router.get('/api/skills/:id/content', getSkillContent);
router.delete('/api/skills/:id', deleteSkill);

// Files & Workspace
router.get('/api/files', listFiles);
router.get('/api/files/content', getFileContent);
router.get('/api/files/download', downloadFile);
router.get('/api/workspace-file', getWorkspaceFile);
router.put('/api/workspace-file', putWorkspaceFile);
router.get('/api/workspace-file/history', getWorkspaceFileHistory);

// Soul
router.get('/api/soul', getSoul);
router.put('/api/soul', putSoul);
router.get('/api/soul/history', getSoulHistory);
router.post('/api/soul/revert', revertSoul);
router.get('/api/soul/templates', getSoulTemplates);

// Settings
router.get('/api/settings', getSettings);
router.post('/api/settings', postSettings);

// Credentials
router.get('/api/credentials', listCredentials);
router.put('/api/credentials/:name', putCredential);
router.delete('/api/credentials/:name', deleteCredential);

// Agents
router.get('/api/agents', listAgents);
router.get('/api/agents/status', agentsStatus);
router.put('/api/agents/:id', updateAgent);

// WiseChef Board
router.get('/api/wisechef-board/version', getBoardVersion);
router.post('/api/wisechef-board/update', updateBoard);

// ──── Chat (proxied to OpenClaw gateway) ────
router.post('/api/chat/session', createChatSession);
router.post('/api/chat/send', sendChatMessage);

// ──── Usage limits (battery widget) ────
router.get('/api/usage-limits', getUsageLimits);

router.get('/api/plano/status', getPlanoStatus);
router.post('/api/plano/start', startPlano);
router.post('/api/plano/stop', stopPlano);
router.get('/api/plano/config', getPlanoConfig);
router.put('/api/plano/config', putPlanoConfig);

// Fleet Management (only active on HQ)
if (process.env.WISECHEF_HQ === 'true') {
  router.get('/api/fleet', getFleet);
  router.get('/api/fleet/:clientId/status', getClientStatus);
  router.post('/api/fleet/:clientId/deploy', deployClient);
  startHealthChecks();
}

// HQ flag for client-side
router.get('/api/env', (_req, res) => {
  res.json({ hq: process.env.WISECHEF_HQ === 'true' });
});

// ──── Health check (unauthenticated, for monitoring / fleet probes) ────
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'wisechef-board',
    version: process.env.npm_package_version || '26.03.2',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});


// ──── Root route: onboarding flow → Enterprise Dashboard / Control UI ────
router.get('/', (req, res, next) => {
  if (!isOnboarded()) {
    return res.sendFile(path.join(__dirname, 'pages', 'onboarding-unified.html'));
  }
  if (!hasLinkedChannel() && !req.query.skip) {
    return res.sendFile(path.join(__dirname, 'pages', 'link-channel.html'));
  }
  // Enterprise tier → Paperclip dashboard (has chat + agent management + tasks)
  const plan = (process.env.WISECHEF_PLAN || 'starter').toLowerCase();
  if (plan === 'enterprise' && fs.existsSync(path.join(__dirname, '..', 'enterprise-dist', 'index.html'))) {
    return res.redirect('/enterprise/');
  }
  // Other tiers → pass through to gateway Control UI (proxy catch-all)
  next();
});

// Board SPA — only accessible at /board/*
router.get('/board', (_req, res) => res.redirect('/board/'));
router.get('/board/*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ──── Catch-all: proxy everything else to OpenClaw gateway ────
// This makes the Control UI (TUI) the default interface
router.all('*', (req, res) => {
  const httpProxy = req.app.get('gatewayProxy');
  if (httpProxy) {
    httpProxy.web(req, res);
  } else {
    res.status(502).send('Gateway unavailable');
  }
});

export default router;
