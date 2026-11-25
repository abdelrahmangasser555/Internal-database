import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'web', 'dist');
const assets = path.join(dist, 'assets');
const bin = path.join(root, 'tools', 'esbuild.exe');

if (!fs.existsSync(bin)) {
  console.error('Missing tools/esbuild.exe. Re-run the dashboard setup or download @esbuild/win32-x64.');
  process.exit(1);
}

fs.mkdirSync(assets, { recursive: true });
fs.copyFileSync(path.join(root, 'web', 'index.html'), path.join(dist, 'index.html'));

const args = [
  path.join('web', 'src', 'main.jsx'),
  '--bundle',
  `--outfile=${path.join('web', 'dist', 'assets', 'app.js')}`,
  '--format=esm',
  '--jsx=automatic',
  '--loader:.css=css',
];

if (process.argv.includes('--watch')) args.push('--watch');
else args.push('--minify');

const result = spawnSync(bin, args, { cwd: root, stdio: 'inherit', shell: false });
process.exit(result.status ?? 1);
