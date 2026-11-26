import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Cross-platform dashboard build (Windows + Linux) using Vite.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Relative config so Windows `shell: true` does not split on spaces in the project path.
const config = path.join('web', 'vite.config.js');
const extra = process.argv.includes('--watch') ? ['--watch'] : [];
const result = spawnSync('npx', ['vite', 'build', '--config', config, ...extra], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
