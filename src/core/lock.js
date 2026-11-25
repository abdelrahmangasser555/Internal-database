import fs from 'node:fs';
import { LOCK_FILE } from './paths.js';

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      if (existing.pid && pidAlive(existing.pid) && existing.pid !== process.pid) {
        return { ok: false, pid: existing.pid };
      }
    } catch {
      // stale lock
    }
  }
  fs.writeFileSync(
    LOCK_FILE,
    JSON.stringify({ pid: process.pid, at: new Date().toISOString() }, null, 2),
  );
  const release = () => {
    try {
      if (fs.existsSync(LOCK_FILE)) {
        const current = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
        if (current.pid === process.pid) fs.unlinkSync(LOCK_FILE);
      }
    } catch {
      // ignore
    }
  };
  process.on('exit', release);
  process.on('SIGINT', () => {
    release();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    release();
    process.exit(0);
  });
  return { ok: true, pid: process.pid, release };
}
