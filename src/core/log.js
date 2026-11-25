import fs from 'node:fs';
import path from 'node:path';
import { LOG_DIR } from './paths.js';

export function logLine(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  process.stdout.write(line);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, 'service.log'), line);
  } catch {
    // logging must never break backups
  }
}
