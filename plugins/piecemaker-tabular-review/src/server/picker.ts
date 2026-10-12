import { execFile } from 'node:child_process';
import path from 'node:path';

import { isInside, toPosix, UserError } from './paths.js';

const PICK_TIMEOUT = 15 * 60_000;

const MAC_SCRIPT = `on run argv
  activate
  set picked to choose file with prompt "Documents à ajouter à l’analyse tabulaire" default location (POSIX file (item 1 of argv)) with multiple selections allowed
  set output to ""
  repeat with chosen in picked
    set output to output & POSIX path of chosen & linefeed
  end repeat
  return output
end run`;

const WINDOWS_SCRIPT = `Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Multiselect = $true
$dialog.Title = 'Documents à ajouter à l’analyse tabulaire'
$dialog.InitialDirectory = $env:PTR_PICK_DIRECTORY
if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $dialog.FileNames -join "\`n" }`;

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { env, timeout: PICK_TIMEOUT, windowsHide: false, encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr });
    });
  });
}

async function nativePick(directory: string): Promise<string[]> {
  if (process.platform === 'darwin') {
    const result = await run('osascript', ['-e', MAC_SCRIPT, directory]);
    if (result.code !== 0) {
      if (/-128/.test(result.stderr)) return [];
      throw new UserError(`Explorateur indisponible : ${result.stderr.trim() || 'erreur inconnue'}`);
    }
    return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  }
  if (process.platform === 'win32') {
    const result = await run('powershell.exe', ['-NoProfile', '-STA', '-Command', WINDOWS_SCRIPT], { ...process.env, PTR_PICK_DIRECTORY: directory });
    if (result.code !== 0) throw new UserError(`Explorateur indisponible : ${result.stderr.trim() || 'erreur inconnue'}`);
    return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }
  throw new UserError('L’explorateur de fichiers n’est disponible que sur macOS et Windows.');
}

export async function pickFiles(project: string): Promise<{ files: string[]; outside: number }> {
  const picked = (await nativePick(project)).map((file) => path.resolve(file));
  const inside = picked.filter((file) => isInside(project, file) && file !== project);
  return { files: inside.map((file) => toPosix(path.relative(project, file))), outside: picked.length - inside.length };
}
