import cron from 'node-cron';
import { getJob, listJobs, patchJob } from './store.js';
import { runBackup } from './backup.js';
import { logLine } from './log.js';

function pad(n) {
  return String(n).padStart(2, '0');
}

export function computeNextRun(interval, from = new Date()) {
  const start = new Date(from);
  if (!interval) return new Date(start.getTime() + 60 * 60 * 1000);
  if (interval.type === 'every') {
    const n = Math.max(Number(interval.every) || 1, 1);
    const ms = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 }[interval.unit] || 3_600_000;
    return new Date(start.getTime() + n * ms);
  }
  if (interval.type === 'daily') {
    const [h, m] = String(interval.time || '02:00').split(':').map(Number);
    const next = new Date(start);
    next.setHours(h || 0, m || 0, 0, 0);
    if (next <= start) next.setDate(next.getDate() + 1);
    return next;
  }
  if (interval.type === 'weekly') {
    const [h, m] = String(interval.time || '02:00').split(':').map(Number);
    const weekday = Number(interval.weekday ?? 0);
    const next = new Date(start);
    next.setHours(h || 0, m || 0, 0, 0);
    const delta = (weekday - next.getDay() + 7) % 7;
    next.setDate(next.getDate() + delta);
    if (next <= start) next.setDate(next.getDate() + 7);
    return next;
  }
  return new Date(start.getTime() + 60 * 60 * 1000);
}

export function describeInterval(interval) {
  if (!interval) return 'Not set';
  if (interval.type === 'every') return `Every ${interval.every} ${interval.unit}`;
  if (interval.type === 'daily') return `Daily at ${interval.time}`;
  if (interval.type === 'weekly') {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return `Weekly on ${days[interval.weekday] || 'Sunday'} at ${interval.time}`;
  }
  return 'Custom';
}

export function ensureNextRun(job) {
  if (!job.enabled) return job;
  if (job.nextRunAt && new Date(job.nextRunAt) > new Date()) return job;
  const next = computeNextRun(job.interval, job.lastRunAt ? new Date(job.lastRunAt) : new Date());
  return patchJob(job.id, { nextRunAt: next.toISOString() });
}

async function runDueJobs({ catchUp = false } = {}) {
  const now = new Date();
  for (const job of listJobs()) {
    if (!job.enabled) continue;
    ensureNextRun(job);
    const fresh = getJob(job.id);
    if (!fresh?.nextRunAt) continue;
    const due = new Date(fresh.nextRunAt) <= now;
    if (!due && !catchUp) continue;
    if (!due) continue;
    try {
      logLine(`Starting backup ${fresh.name} (${catchUp ? 'catch-up' : 'schedule'})`);
      await runBackup(fresh.id, { reason: catchUp ? 'catch-up' : 'schedule' });
      const next = computeNextRun(fresh.interval, new Date());
      patchJob(fresh.id, { lastRunAt: now.toISOString(), nextRunAt: next.toISOString() });
    } catch (err) {
      const next = computeNextRun(fresh.interval, new Date());
      patchJob(fresh.id, { lastRunAt: now.toISOString(), nextRunAt: next.toISOString() });
      logLine(`Scheduled backup error [${fresh.name}]: ${err.message}`);
    }
  }
}

let task;

export function startScheduler() {
  for (const job of listJobs()) ensureNextRun(job);
  runDueJobs({ catchUp: true }).catch((err) => logLine(err.message));
  if (task) return;
  task = cron.schedule('* * * * *', () => {
    runDueJobs().catch((err) => logLine(err.message));
  });
  logLine('Scheduler started (checks every minute)');
}

export function stopScheduler() {
  task?.stop();
  task = null;
}

export function formatNext(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
