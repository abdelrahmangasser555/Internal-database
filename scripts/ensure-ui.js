import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Build the dashboard when web/dist is missing or older than its sources,
// so pulling new UI code and running `npm start` never serves a stale build.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexFile = path.join(root, 'web', 'dist', 'index.html');

function newestMtime(target) {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = 0;
  for (const entry of fs.readdirSync(target)) newest = Math.max(newest, newestMtime(path.join(target, entry)));
  return newest;
}

let reason = null;
if (!fs.existsSync(indexFile)) reason = 'web/dist is missing';
else {
  const built = fs.statSync(indexFile).mtimeMs;
  const sources = ['web/src', 'web/public', 'web/index.html', 'web/vite.config.js'].map((p) => newestMtime(path.join(root, p)));
  if (Math.max(...sources) > built) reason = 'dashboard sources changed';
}
if (!reason) process.exit(0);

console.log(`Building dashboard (${reason})…`);
const result = spawnSync('npm', ['run', 'build:ui'], { cwd: root, stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
