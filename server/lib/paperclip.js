/**
 * Paperclip integration helper for WiseChef Board
 * Manages Paperclip as a sidecar service for task management
 * @version 26.04.0
 */

import { createServer } from '@paperclipai/server';
import http from 'http';

let paperclipServer = null;
let paperclipPort = 3338;
let companyId = null;

/**
 * Start Paperclip server as sidecar
 */
export async function startPaperclip(opts = {}) {
  paperclipPort = opts.port || 3338;
  
  try {
    paperclipServer = await createServer({
      port: paperclipPort,
      database: opts.database || 'embedded',
      logLevel: opts.logLevel || 'warn',
    });
    
    console.log(`📎 Paperclip sidecar running on port ${paperclipPort}`);
    
    // Auto-create company if needed
    if (opts.companyName) {
      companyId = await ensureCompany(opts.companyName, opts.companySlug);
    }
    
    return paperclipServer;
  } catch (err) {
    console.error('📎 Paperclip startup failed:', err.message);
    console.log('📎 Falling back to file-based task storage');
    return null;
  }
}

/**
 * Stop Paperclip server
 */
export async function stopPaperclip() {
  if (paperclipServer) {
    try {
      await paperclipServer.close();
      console.log('📎 Paperclip sidecar stopped');
    } catch (err) {
      console.error('📎 Paperclip shutdown error:', err.message);
    }
  }
}

/**
 * Check if Paperclip is available
 */
export function isPaperclipReady() {
  return paperclipServer !== null;
}

/**
 * Make a request to Paperclip API
 */
async function paperclipAPI(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: paperclipPort,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Ensure company exists in Paperclip
 */
async function ensureCompany(name, slug) {
  try {
    const res = await paperclipAPI('GET', '/companies');
    if (res.status === 200 && Array.isArray(res.data)) {
      const existing = res.data.find(c => c.slug === slug || c.name === name);
      if (existing) return existing.id;
    }
    
    const createRes = await paperclipAPI('POST', '/companies', { name, slug: slug || name.toLowerCase().replace(/\s+/g, '-') });
    if (createRes.status === 201 || createRes.status === 200) {
      return createRes.data.id;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Sync a task to Paperclip (fire-and-forget, doesn't block main flow)
 */
export async function syncTaskToPaperclip(task) {
  if (!isPaperclipReady() || !companyId) return;
  
  try {
    const issue = mapTaskToIssue(task);
    
    // Try update first, create if not found
    const updateRes = await paperclipAPI('PUT', `/companies/${companyId}/issues/${task.id}`, issue);
    if (updateRes.status === 404) {
      await paperclipAPI('POST', `/companies/${companyId}/issues`, { ...issue, externalId: task.id });
    }
  } catch (err) {
    // Non-critical — log but don't fail
    console.debug('📎 Paperclip sync failed:', err.message);
  }
}

/**
 * Sync all tasks to Paperclip
 */
export async function syncAllTasks(tasks) {
  if (!isPaperclipReady() || !companyId) return;
  
  for (const task of tasks) {
    await syncTaskToPaperclip(task);
  }
}

/**
 * Get completion rate from Paperclip data
 */
export function computeCompletionRate(tasks) {
  const total = tasks.filter(t => t.status !== 'archived').length;
  if (total === 0) return { rate: 0, completed: 0, total: 0 };
  
  const completed = tasks.filter(t => t.status === 'done').length;
  const rate = Math.round((completed / total) * 100);
  
  // Include recurring task run history for a richer metric
  let totalRuns = 0;
  let successfulRuns = 0;
  for (const t of tasks) {
    if (Array.isArray(t.runHistory)) {
      for (const run of t.runHistory) {
        totalRuns++;
        if (!run.error) successfulRuns++;
      }
    }
  }
  
  return {
    rate,
    completed,
    total,
    runs: {
      total: totalRuns,
      successful: successfulRuns,
      rate: totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : 0,
    }
  };
}

/**
 * Map WiseChef task to Paperclip issue format
 */
function mapTaskToIssue(task) {
  const priorityMap = { low: 1, medium: 2, high: 3, critical: 4 };
  const statusMap = {
    backlog: 'backlog',
    todo: 'todo',
    'in-progress': 'in_progress',
    done: 'done',
    archived: 'cancelled',
  };
  
  return {
    title: task.title,
    description: task.description || '',
    status: statusMap[task.status] || 'backlog',
    priority: priorityMap[task.priority] || 2,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    metadata: {
      skills: task.skills,
      schedule: task.schedule,
      scheduleEnabled: task.scheduleEnabled,
      subagentId: task.subagentId,
    },
  };
}

export { paperclipAPI, companyId };
