import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getRecord } from './store.js';
import { recordExists } from './backup.js';

export function revealPath(targetPath) {
  if (!targetPath) throw new Error('No path');
  const exists = fs.existsSync(targetPath);
  const folder = exists
    ? fs.statSync(targetPath).isDirectory()
      ? targetPath
      : path.dirname(targetPath)
    : path.dirname(targetPath);
  const folderExists = fs.existsSync(folder);

  if (process.platform === 'win32') {
    if (exists && !fs.statSync(targetPath).isDirectory()) {
      spawn('explorer', [`/select,${targetPath}`], { detached: true, stdio: 'ignore' });
    } else if (folderExists) {
      spawn('explorer', [folder], { detached: true, stdio: 'ignore' });
    }
  } else {
    const openTarget = exists ? (fs.statSync(targetPath).isDirectory() ? targetPath : folder) : folder;
    if (fs.existsSync(openTarget)) {
      spawn('xdg-open', [openTarget], { detached: true, stdio: 'ignore' });
    }
  }

  return { exists, folder, folderExists, path: targetPath };
}

export function revealRecord(id) {
  const record = getRecord(id);
  if (!record) throw new Error('Record not found');
  const exists = recordExists(record);
  const revealed = revealPath(record.filePath);
  return { ...revealed, exists, record };
}
