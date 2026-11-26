import { apiDevPort, assertNode, installDeps, log, pullLatest, spawnNode, stopChild, viteBin, waitForPort } from './workspace.js';
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
  const port = apiDevPort();
  log(`Starting API (${port}) then Vite dashboard (5173) with hot reload`);
  const children = [];
  let shuttingDown = false;

  const bindChild = (child) => {
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
  };

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) stopChild(child);
  };

  const api = spawnNode(['--watch', 'src/index.js'], { env: { BACKUP_DEV: '1' } });
  children.push(api);
  bindChild(api);

  log(`Waiting for API on http://127.0.0.1:${port}…`);
  waitForPort(port)
    .then(() => {
      if (shuttingDown) return;
      log(`API ready — launching Vite on http://127.0.0.1:5173`);
      const ui = spawnNode([viteBin(), '--config', 'web/vite.config.js']);
      children.push(ui);
      bindChild(ui);
    })
    .catch((err) => {
      console.error(`[setup] ${err.message}`);
      shutdown();
      process.exit(1);
    });

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
