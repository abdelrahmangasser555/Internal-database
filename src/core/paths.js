import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '../..');
export const DATA_DIR = path.join(ROOT, 'data');
export const LOG_DIR = path.join(DATA_DIR, 'logs');
export const TMP_DIR = path.join(DATA_DIR, 'tmp');
export const MASTER_KEY_FILE = path.join(DATA_DIR, 'master.key');
export const CONNECTIONS_FILE = path.join(DATA_DIR, 'connections.json');
export const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
export const RECORDS_FILE = path.join(DATA_DIR, 'records.json');
export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
export const ROTATION_AUDIT_FILE = path.join(DATA_DIR, 'rotation-audit.json');
export const WRITE_AUDIT_FILE = path.join(DATA_DIR, 'write-audit.json');
export const LOCK_FILE = path.join(DATA_DIR, 'scheduler.lock');

export function ensureDataDirs() {
  for (const dir of [DATA_DIR, LOG_DIR, TMP_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function deviceName() {
  try {
    return os.hostname();
  } catch {
    return 'unknown-device';
  }
}
