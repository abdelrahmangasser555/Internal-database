import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './paths.js';

const TASK_NAME = 'TailoredTechBackupService';
const LINUX_UNIT = 'backup-service.service';

function nodeBin() {
  return process.execPath;
}

function windowsLauncher() {
  const file = path.join(ROOT, 'scripts', 'run-worker.cmd');
  fs.writeFileSync(
    file,
    `@echo off\r\ncd /d ${quote(ROOT)}\r\n${quote(nodeBin())} ${quote(path.join(ROOT, 'src', 'worker.js'))}\r\n`,
  );
  return file;
}

function quote(value) {
  return `"${value}"`;
}

function linuxUnitPath() {
  return path.join(os.homedir(), '.config', 'systemd', 'user', LINUX_UNIT);
}

export function autostartStatus() {
  if (process.platform === 'win32') {
    const res = spawnSync('schtasks', ['/Query', '/TN', TASK_NAME], { encoding: 'utf8' });
    const startup = fs.existsSync(windowsStartupPath());
    return {
      enabled: res.status === 0 || startup,
      kind: 'windows-task',
      name: TASK_NAME,
      taskScheduler: res.status === 0,
      startupFolder: startup,
    };
  }
  const unit = linuxUnitPath();
  const enabled = fs.existsSync(unit);
  return { enabled, kind: 'systemd-user', name: LINUX_UNIT, path: unit };
}

function windowsStartupPath() {
  return path.join(
    os.homedir(),
    'AppData',
    'Roaming',
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
    'TailoredTechBackupService.cmd',
  );
}

export function enableAutostart() {
  if (process.platform === 'win32') {
    const launcher = windowsLauncher();
    const cmdPath = windowsStartupPath();
    fs.mkdirSync(path.dirname(cmdPath), { recursive: true });
    fs.writeFileSync(
      cmdPath,
      `@echo off\r\ncd /d ${quote(ROOT)}\r\nstart "" ${quote(nodeBin())} ${quote(path.join(ROOT, 'src', 'worker.js'))}\r\n`,
    );
    const res = spawnSync(
      'schtasks',
      ['/Create', '/TN', TASK_NAME, '/TR', launcher, '/SC', 'ONLOGON', '/RL', 'LIMITED', '/F'],
      { encoding: 'utf8' },
    );
    return {
      ...autostartStatus(),
      startupFolder: true,
      taskScheduler: res.status === 0,
      note:
        res.status === 0
          ? 'Task Scheduler and Startup folder are set'
          : 'Startup folder is set. Task Scheduler needs permission (run the terminal as Administrator to add it).',
    };
  }

  const unitDir = path.dirname(linuxUnitPath());
  fs.mkdirSync(unitDir, { recursive: true });
  fs.writeFileSync(
    linuxUnitPath(),
    `[Unit]
Description=Tailored Tech MongoDB Backup Service
After=network-online.target

[Service]
Type=simple
WorkingDirectory="${ROOT}"
ExecStart="${nodeBin()}" "${path.join(ROOT, 'src', 'worker.js')}"
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`,
  );
  spawnSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf8' });
  const enable = spawnSync('systemctl', ['--user', 'enable', '--now', LINUX_UNIT], { encoding: 'utf8' });
  if (enable.status !== 0) {
    spawnSync('systemctl', ['--user', 'start', LINUX_UNIT], { encoding: 'utf8' });
  }
  return autostartStatus();
}

export function disableAutostart() {
  if (process.platform === 'win32') {
    spawnSync('schtasks', ['/Delete', '/TN', TASK_NAME, '/F'], { encoding: 'utf8' });
    const cmdPath = windowsStartupPath();
    if (fs.existsSync(cmdPath)) fs.unlinkSync(cmdPath);
    return autostartStatus();
  }
  spawnSync('systemctl', ['--user', 'disable', '--now', LINUX_UNIT], { encoding: 'utf8' });
  if (fs.existsSync(linuxUnitPath())) fs.unlinkSync(linuxUnitPath());
  return autostartStatus();
}
