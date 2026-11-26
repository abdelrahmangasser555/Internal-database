import { assertNode, installDeps, log, pullLatest, spawnNode, stopChild, viteBin } from './workspace.js';
import { ensureUi } from './ensure-ui.js';

const mode = process.argv[2] === 'start' ? 'start' : 'dev';

assertNode();
pullLatest();
installDeps();

if (mode === 'start') {
  ensureUi();
  log('Starting dashboard on http://127.0.0.1:4780');
  const child = spawnNode(['src/index.js']);
  child.on('exit', (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
} else {
  log('Starting API (4780) + Vite dashboard (5173) with hot reload');
  const children = [];
  let shuttingDown = false;

  const api = spawnNode(['--watch', 'src/index.js'], { env: { BACKUP_DEV: '1' } });
  const ui = spawnNode([viteBin(), '--config', 'web/vite.config.js']);
  children.push(api, ui);

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) stopChild(child);
  };

  for (const child of children) {
    child.on('exit', (code) => {
      if (shuttingDown) return;
      shuttingDown = true;
      for (const other of children) if (other !== child) stopChild(other);
      process.exit(code ?? 1);
    });
    child.on('error', (err) => {
      console.error(`[setup] ${err.message}`);
      shutdown();
      process.exit(1);
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
