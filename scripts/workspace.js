import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function log(msg) {
  console.log(`[setup] ${msg}`);
}

export function warn(msg) {
  console.warn(`[setup] ${msg}`);
}

export function assertNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 20) {
    console.error(`[setup] Node.js 20 or newer is required (found ${process.version}).`);
    process.exit(1);
  }
  if (major < 22 || (major === 22 && minor < 13)) {
    warn(`Node ${process.version}: SQLite needs 22.13+. Other engines still work.`);
  }
}

export function packageManager() {
  const ua = process.env.npm_config_user_agent || '';
  if (ua.includes('pnpm')) return 'pnpm';
  if (ua.includes('yarn')) return 'yarn';
  if (ua.includes('bun')) return 'bun';
  if (fs.existsSync(path.join(ROOT, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(ROOT, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

export function runPm(args) {
  const pm = packageManager();
  const execPath = process.env.npm_execpath;
  const result = execPath
    ? spawnSync(process.execPath, [execPath, ...args], { cwd: ROOT, stdio: 'inherit' })
    : spawnSync(pm, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) {
    console.error(`[setup] Could not run ${pm}: ${result.error.message}`);
    process.exit(1);
  }
  return result.status ?? 1;
}

function git(args) {
  return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

export function pullLatest() {
  if (process.env.BACKUP_SKIP_PULL === '1') {
    log('Skipping git pull (BACKUP_SKIP_PULL=1).');
    return false;
  }
  if (!fs.existsSync(path.join(ROOT, '.git'))) {
    log('Not a git checkout — using the files on disk.');
    return false;
  }
  const version = git(['--version']);
  if (version.error?.code === 'ENOENT') {
    warn('git is not on PATH — skipping pull. Install Git, or set BACKUP_SKIP_PULL=1.');
    return false;
  }
  const inside = git(['rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0 || String(inside.stdout).trim() !== 'true') {
    log('Not a git checkout — using the files on disk.');
    return false;
  }
  const remotes = git(['remote']);
  if (remotes.status !== 0 || !String(remotes.stdout).trim()) {
    log('No git remote configured — using the files on disk.');
    return false;
  }
  const dirty = git(['status', '--porcelain']);
  if (dirty.status !== 0) {
    warn(`git status failed: ${(dirty.stderr || dirty.error?.message || 'unknown error').trim()}`);
    return false;
  }
  if (String(dirty.stdout).trim()) {
    warn('Local changes detected — not pulling, so nothing on disk is overwritten.');
    warn('Commit or stash, or set BACKUP_SKIP_PULL=1.');
    return false;
  }
  const branch = String(git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout || '').trim() || 'HEAD';
  const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  if (upstream.status !== 0) {
    warn(`Branch "${branch}" has no upstream (the remote branch it tracks).`);
    warn(`Fix: git push -u origin ${branch}`);
    return false;
  }
  const target = String(upstream.stdout).trim();
  log(`Updating from ${target}…`);
  const pull = git(['pull', '--ff-only']);
  if (pull.status !== 0) {
    warn((pull.stderr || pull.stdout || 'git pull --ff-only failed').trim());
    warn('Continuing with the files already on disk.');
    return false;
  }
  const head = String(git(['rev-parse', '--short', 'HEAD']).stdout || '').trim();
  const summary = String(pull.stdout || '').trim().split('\n').pop() || 'Already up to date.';
  log(`${summary}${head ? ` (${head})` : ''}`);
  return true;
}

export function installDeps() {
  const pm = packageManager();
  log(`Installing dependencies with ${pm} (Windows and Linux use the same command)…`);
  const code = runPm(['install']);
  if (code !== 0) {
    console.error('[setup] Dependency install failed.');
    process.exit(code);
  }
}

export function viteBin() {
  const file = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(file)) {
    console.error('[setup] Vite is missing after install. Delete node_modules and run npm install / pnpm install.');
    process.exit(1);
  }
  return file;
}

export function stopChild(child) {
  if (!child || child.killed || child.exitCode != null) return;
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  child.kill('SIGTERM');
}

export function spawnNode(args, { env } = {}) {
  return spawn(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    windowsHide: true,
  });
}

/** Poll until something accepts TCP connections (API listen ready). */
export function waitForPort(port, { host = '127.0.0.1', timeoutMs = 120_000, intervalMs = 200 } = {}) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ port, host }, () => {
        socket.end();
        resolve();
      });
      socket.setTimeout(1500, () => socket.destroy());
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${host}:${port}`));
          return;
        }
        setTimeout(attempt, intervalMs);
      });
    };
    attempt();
  });
}

export function apiDevPort() {
  return Number(process.env.APP_PORT || 4780);
}
