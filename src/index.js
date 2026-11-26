import { loadEnv } from './core/env.js';
import { ensureDataDirs } from './core/paths.js';
import { acquireLock } from './core/lock.js';
import { startScheduler } from './core/schedule.js';
import { startServer } from './server.js';
import { logLine } from './core/log.js';
import { enableAutostart, autostartStatus } from './core/autostart.js';

loadEnv();
ensureDataDirs();

const lock = acquireLock();
if (lock.ok) {
  startScheduler();
} else {
  logLine(`Scheduler already running in pid ${lock.pid}; dashboard only`);
}

const { url } = await startServer();
logLine(`Dashboard ${url}`);

if (!autostartStatus().enabled) {
  try {
    enableAutostart();
    logLine('Autostart enabled for this device');
  } catch (err) {
    logLine(`Autostart not enabled: ${err.message}`);
  }
}

if (process.env.BACKUP_DEV === '1') {
  logLine('Dev UI http://127.0.0.1:5173 (this process is the API only)');
} else {
  try {
    const open = (await import('open')).default;
    await open(url);
  } catch (err) {
    logLine(`Open browser manually: ${url} (${err.message})`);
  }
}
