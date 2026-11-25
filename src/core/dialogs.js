import { spawn } from 'node:child_process';

function run(command, args, { input } = {}) {
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
    if (input) child.stdin.end(input);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err || `Dialog exited ${code}`));
    });
  });
}

export async function pickFolder() {
  if (process.platform === 'win32') {
    const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select backup folder'
$dialog.ShowNewFolderButton = $true
$dialog.RootFolder = [Environment+SpecialFolder]::MyComputer
[System.Windows.Forms.Application]::EnableVisualStyles() | Out-Null
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }
`;
    const selected = await run('powershell.exe', [
      '-NoProfile',
      '-STA',
      '-Command',
      script,
    ]);
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
