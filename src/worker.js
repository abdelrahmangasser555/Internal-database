import { loadEnv } from './core/env.js';
import { ensureDataDirs } from './core/paths.js';
import { acquireLock } from './core/lock.js';
import { startScheduler } from './core/schedule.js';
import { logLine } from './core/log.js';

loadEnv();
ensureDataDirs();

const lock = acquireLock();
if (!lock.ok) {
  logLine(`Worker already running in pid ${lock.pid}`);
  process.exit(0);
}

startScheduler();
logLine('Backup worker is running in the background');

setInterval(() => {}, 60_000);
