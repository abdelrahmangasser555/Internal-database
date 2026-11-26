import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: false });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.stderr.on('data', (d) => {
      err += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error((err || out || `Dialog exited ${code}`).trim()));
    });
  });
}

function runPowerShell(script) {
  const file = path.join(os.tmpdir(), `backup-service-dialog-${process.pid}-${Date.now()}.ps1`);
  const body = `$ProgressPreference = 'SilentlyContinue'\n$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n${script}\n`;
  fs.writeFileSync(file, body, 'utf8');
  return run('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', file]).finally(() => {
    fs.rmSync(file, { force: true });
  });
}

const WIN_OWNER = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.StartPosition = 'Manual'
$owner.Location = New-Object System.Drawing.Point(-32000, -32000)
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Show()
$owner.Activate() | Out-Null
`;

export async function pickFolder() {
  if (process.platform === 'win32') {
    const selected = await runPowerShell(`
${WIN_OWNER}
$picked = $null
try {
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = 'Select backup folder'
  $dialog.ShowNewFolderButton = $true
  try { $dialog.UseDescriptionForTitle = $true } catch {}
  $result = $dialog.ShowDialog($owner)
  if ($result -eq [System.Windows.Forms.DialogResult]::OK) { $picked = $dialog.SelectedPath }
} catch {
  $shell = New-Object -ComObject Shell.Application
  $folder = $shell.BrowseForFolder(0, 'Select backup folder', 0)
  if ($folder) { $picked = $folder.Self.Path }
}
$owner.Close()
if ($picked) { [Console]::Out.WriteLine($picked) }
`);
    return selected || null;
  }

  try {
    return await run('zenity', ['--file-selection', '--directory', '--title=Select backup folder']);
  } catch {
    try {
      return await run('kdialog', ['--getexistingdirectory', `${process.env.HOME || '/'}`]);
    } catch {
      throw new Error('No folder dialog available. Type the path instead, or install zenity.');
    }
  }
}

export async function pickFile() {
  if (process.platform === 'win32') {
    const selected = await runPowerShell(`
${WIN_OWNER}
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Select a backup file'
$dialog.Filter = 'Backup archives (*.zip, *.zip.enc)|*.zip;*.zip.enc|All files (*.*)|*.*'
$dialog.CheckFileExists = $true
$result = $dialog.ShowDialog($owner)
$owner.Close()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.WriteLine($dialog.FileName) }
`);
    return selected || null;
  }

  try {
    return await run('zenity', ['--file-selection', '--title=Select a backup file']);
  } catch {
    throw new Error('No file dialog available. Type the path instead.');
  }
}
