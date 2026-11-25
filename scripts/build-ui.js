import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Cross-platform dashboard build (Windows + Linux) using Vite.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = path.join(root, 'web', 'vite.config.js');
const args = process.argv.includes('--watch') ? ['build', '--watch', '--config', config] : ['build', '--config', config];
const result = spawnSync('npx', ['vite', ...args], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
