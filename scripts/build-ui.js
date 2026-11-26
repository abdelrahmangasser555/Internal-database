import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { viteBin, ROOT } from './workspace.js';

// Cross-platform dashboard build (Windows + Linux) using the local Vite binary.
// Relative config so paths with spaces (common on Windows) stay one argument.
const result = spawnSync(process.execPath, [viteBin(), 'build', '--config', path.join('web', 'vite.config.js')], {
  cwd: ROOT,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
