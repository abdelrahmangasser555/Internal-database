import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexFile = path.join(root, 'web', 'dist', 'index.html');
if (fs.existsSync(indexFile)) process.exit(0);

console.log('Building dashboard (web/dist is missing)…');
const result = spawnSync('npm', ['run', 'build:ui'], { cwd: root, stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
