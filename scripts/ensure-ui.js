import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { log, ROOT } from './workspace.js';

// Build the React dashboard when web/dist is missing or older than its sources,
// so `npm start` never serves a stale build.
const indexFile = path.join(ROOT, 'web', 'dist', 'index.html');

function newestMtime(target) {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = 0;
  for (const entry of fs.readdirSync(target)) newest = Math.max(newest, newestMtime(path.join(target, entry)));
  return newest;
}

export function ensureUi() {
  let reason = null;
  if (!fs.existsSync(indexFile)) reason = 'web/dist is missing';
  else {
    const built = fs.statSync(indexFile).mtimeMs;
    const sources = ['web/src', 'web/public', 'web/index.html', 'web/vite.config.js'].map((p) => newestMtime(path.join(ROOT, p)));
    if (Math.max(...sources) > built) reason = 'dashboard sources changed';
  }
  if (!reason) return;

  log(`Building dashboard (${reason})…`);
  const result = spawnSync(process.execPath, [path.join('scripts', 'build-ui.js')], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if ((result.status ?? 1) !== 0) {
    console.error('[setup] Dashboard build failed.');
    process.exit(result.status ?? 1);
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) ensureUi();
