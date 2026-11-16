import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type PmCommandOptions = {
  applicationRoot: string;
  piecemakerHome: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  execPath?: string;
  userHome?: string;
  persistWindowsPath?: (binDir: string) => void;
};

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function posixLauncher(runtime: string, script: string) {
  return `#!/bin/sh\n[ -z "\${NO_COLOR+x}" ] || unset FORCE_COLOR\nELECTRON_RUN_AS_NODE=1 exec ${shellQuote(runtime)} ${shellQuote(script)} "$@"\n`;
}

function windowsLauncher(runtime: string, script: string) {
  return `@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${runtime}" "${script}" %*\r\n`;
}

function prependToPath(env: NodeJS.ProcessEnv, binDir: string, platform: NodeJS.Platform) {
  const delimiter = platform === 'win32' ? ';' : ':';
  const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
  const entries = (env[key] ?? '').split(delimiter).filter((entry) => entry && entry !== binDir);
  env[key] = [binDir, ...entries].join(delimiter);
}

function persistPosixPath(binDir: string, userHome: string) {
  const always = ['.zshenv', '.zshrc', '.bashrc'].map((name) => path.join(userHome, name));
  const existing = ['.bash_profile', '.profile'].map((name) => path.join(userHome, name)).filter((file) => fs.existsSync(file));
  for (const file of [...always, ...existing]) {
    const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (content.includes(binDir)) continue;
    fs.appendFileSync(file, `\n# PieceMaker\nexport PATH="${binDir}:$PATH"\n`, 'utf8');
  }
}

function persistWindowsUserPath(binDir: string) {
  const quoted = binDir.replace(/'/g, "''");
  const script = [
    "$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)",
    "$p = [string]$k.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)",
    `if (($p -split ';') -notcontains '${quoted}') { $k.SetValue('Path', ((@($p, '${quoted}') | Where-Object { $_ }) -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString); [Environment]::SetEnvironmentVariable('PIECEMAKER_PATH', '${quoted}', 'User') }`,
  ].join('; ');
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, () => undefined);
}

export function installPmCommand(options: PmCommandOptions): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const runtime = options.execPath ?? process.execPath;
  const binDir = path.join(options.piecemakerHome, 'bin');
  const script = fs.realpathSync(path.join(options.applicationRoot, 'server', 'piecemaker', 'vendor', 'skills', 'Skill-PieceMaker', 'scripts', 'pm.mjs'));

  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'pm'), posixLauncher(runtime, script), { mode: 0o755 });
  fs.chmodSync(path.join(binDir, 'pm'), 0o755);
  if (platform === 'win32') fs.writeFileSync(path.join(binDir, 'pm.cmd'), windowsLauncher(runtime, script));

  prependToPath(env, binDir, platform);
  if (platform === 'win32') (options.persistWindowsPath ?? persistWindowsUserPath)(binDir);
  else persistPosixPath(binDir, options.userHome ?? os.homedir());
  return binDir;
}
