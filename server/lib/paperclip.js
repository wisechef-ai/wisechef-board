/**
 * Paperclip integration helper for WiseChef Board.
 *
 * Default behavior is to connect to an already-running Paperclip surface
 * provided by the enterprise panel. Embedded startup is opt-in only.
 */

import http from 'http';

let paperclipServer = null;
let paperclipPort = parseInt(process.env.PAPERCLIP_PORT || '3100', 10);
let paperclipBasePath = process.env.PAPERCLIP_BASE_PATH || '/api';
let paperclipMode = 'disabled';
let paperclipReady = false;
let companyId = null;

function withBasePath(apiPath) {
  const trimmedBase = `/${String(paperclipBasePath || '/api').replace(/^\/+|\/+$/g, '')}`;
  const trimmedPath = `/${String(apiPath || '/').replace(/^\/+/, '')}`;
  if (trimmedPath === trimmedBase || trimmedPath.startsWith(`${trimmedBase}/`)) {
    return trimmedPath;
  }
  return `${trimmedBase}${trimmedPath}`;
}

async function probeHealth() {
  try {
    const res = await paperclipAPI('GET', '/health');
    return res.status >= 200 && res.status < 500;
  } catch {
    return false;
  }
}

/**
 * Start Paperclip server as sidecar
 */
export async function startPaperclip(opts = {}) {
  paperclipPort = opts.port || parseInt(process.env.PAPERCLIP_PORT || '3100', 10);
  paperclipBasePath = opts.basePath || process.env.PAPERCLIP_BASE_PATH || '/api';
  paperclipMode = String(opts.mode || process.env.PAPERCLIP_MODE || 'external').toLowerCase();
  paperclipReady = false;

  if (paperclipMode !== 'embedded') {
    const reachable = await probeHealth();
    if (!reachable) {
      console.log(`📎 Paperclip ${paperclipMode} mode unavailable on port ${paperclipPort}; board will continue without task sync`);
      return null;
    }

    paperclipReady = true;
    console.log(`📎 Paperclip external surface detected on port ${paperclipPort}`);

    if (opts.companyName) {
      companyId = await ensureCompany(opts.companyName, opts.companySlug);
    }

    return null;
  }

  try {
    const paperclipModule = await import('@paperclipai/server');
    const startServer = paperclipModule.startServer || paperclipModule.createServer;
    if (typeof startServer !== 'function') {
      throw new Error('No compatible Paperclip server export found');
    }

    paperclipServer = await startServer({
      port: paperclipPort,
      database: opts.database || 'embedded',
      logLevel: opts.logLevel || 'warn',
    });

    paperclipReady = true;
    console.log(`📎 Paperclip embedded server running on port ${paperclipPort}`);

    // Auto-create company if needed
    if (opts.companyName) {
      companyId = await ensureCompany(opts.companyName, opts.companySlug);
    }

    return paperclipServer;
  } catch (err) {
    console.error('📎 Paperclip startup failed:', err.message);
    console.log('📎 Falling back to file-based task storage');
    paperclipReady = false;
    paperclipServer = null;
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
      console.log('📎 Paperclip embedded server stopped');
    } catch (err) {
      console.error('📎 Paperclip shutdown error:', err.message);
    }
  }
  paperclipReady = false;
  paperclipServer = null;
}

/**
 * Check if Paperclip is available
 */
export function isPaperclipReady() {
  return paperclipReady;
}

/**
 * Make a request to Paperclip API
 */
async function paperclipAPI(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: paperclipPort,
      path: withBasePath(path),
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
