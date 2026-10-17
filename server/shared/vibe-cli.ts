import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import crossSpawn from 'cross-spawn';

export const VIBE_API_KEY_VARIABLE = 'MISTRAL_API_KEY';
export const VIBE_KEYRING_SERVICES = ['ai.mistral.vibe', 'vibe'] as const;

export type VibeApiKeySource = 'process_env' | 'env_file' | 'keyring';

export type VibeCliHost = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  homedir: string;
  existsSync: (filePath: string) => boolean;
  readFileSync: (filePath: string, encoding: 'utf8') => string;
  spawnSync: typeof crossSpawn.sync;
  keyringServices: readonly string[];
};

export function currentVibeCliHost(): VibeCliHost {
  return {
    platform: process.platform,
    env: process.env,
    homedir: os.homedir(),
    existsSync: fs.existsSync,
    readFileSync: fs.readFileSync,
    spawnSync: crossSpawn.sync,
    keyringServices: VIBE_KEYRING_SERVICES,
  };
}

function pathApi(host: VibeCliHost) {
  return host.platform === 'win32' ? path.win32 : path.posix;
}

function readEnv(host: VibeCliHost, name: string): string | undefined {
  const key = Object.keys(host.env).find((candidate) => (
    host.platform === 'win32' ? candidate.toLowerCase() === name.toLowerCase() : candidate === name
  ));
  const value = key ? host.env[key]?.trim() : undefined;
  return value || undefined;
}

function expandHome(host: VibeCliHost, value: string): string {
  return pathApi(host).resolve(value.replace(/^~(?=$|[\\/])/, host.homedir));
}

export function piecemakerVibeDirectory(host: VibeCliHost = currentVibeCliHost()): string {
  const piecemakerHome = readEnv(host, 'PIECEMAKER_HOME');
  return pathApi(host).join(piecemakerHome ? expandHome(host, piecemakerHome) : pathApi(host).join(host.homedir, '.piecemaker'), 'vibe');
}

export function piecemakerVibeBinDirectory(host: VibeCliHost = currentVibeCliHost()): string {
  return pathApi(host).join(piecemakerVibeDirectory(host), host.platform === 'win32' ? 'Scripts' : 'bin');
}

export function vibeBinDirectoryCandidates(host: VibeCliHost = currentVibeCliHost()): string[] {
  const api = pathApi(host);
  const uvToolBin = readEnv(host, 'UV_TOOL_BIN_DIR');
  const xdgBin = readEnv(host, 'XDG_BIN_HOME');
  const xdgData = readEnv(host, 'XDG_DATA_HOME');
  return [
    uvToolBin ? expandHome(host, uvToolBin) : '',
    xdgBin ? expandHome(host, xdgBin) : '',
    xdgData ? api.resolve(expandHome(host, xdgData), '..', 'bin') : '',
    api.join(host.homedir, '.local', 'bin'),
    piecemakerVibeBinDirectory(host),
  ].filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
}

export function findVibeBinDirectory(host: VibeCliHost = currentVibeCliHost()): string | null {
  const executableName = host.platform === 'win32' ? 'vibe.exe' : 'vibe';
  return vibeBinDirectoryCandidates(host)
    .find((directory) => host.existsSync(pathApi(host).join(directory, executableName))) ?? null;
}

export function resolveVibeExecutable(host: VibeCliHost = currentVibeCliHost()): string {
  const directory = findVibeBinDirectory(host);
  return directory ? pathApi(host).join(directory, host.platform === 'win32' ? 'vibe.exe' : 'vibe') : 'vibe';
}

export function isVibeInstalled(host: VibeCliHost = currentVibeCliHost()): boolean {
  try {
    const result = host.spawnSync(resolveVibeExecutable(host), ['--version'], { stdio: 'ignore', timeout: 5000 });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

function vibeHomeDirectory(host: VibeCliHost): string {
  const vibeHome = readEnv(host, 'VIBE_HOME');
  return vibeHome ? expandHome(host, vibeHome) : pathApi(host).join(host.homedir, '.vibe');
}

export function vibeEnvFilePath(host: VibeCliHost = currentVibeCliHost()): string {
  return pathApi(host).join(vibeHomeDirectory(host), '.env');
}

function configuredVibeTheme(host: VibeCliHost): string | null {
  try {
    const content = host.readFileSync(pathApi(host).join(vibeHomeDirectory(host), 'config.toml'), 'utf8');
    return content.match(/^\s*theme\s*=\s*["']([^"']*)["']/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function vibeTerminalEnvironment(host: VibeCliHost = currentVibeCliHost()): Record<string, string> {
  if (host.platform !== 'win32' || readEnv(host, 'VIBE_THEME')) {
    return {};
  }
  const theme = configuredVibeTheme(host);
  return theme && theme !== 'auto' ? {} : { VIBE_THEME: 'textual-dark' };
}

function envFileHasApiKey(host: VibeCliHost): boolean {
  let content: string;
  try {
    content = host.readFileSync(vibeEnvFilePath(host), 'utf8');
  } catch {
    return false;
  }
  return content.split(/\r?\n/).some((line) => {
    const match = line.match(new RegExp(`^\\s*(?:export\\s+)?${VIBE_API_KEY_VARIABLE}\\s*=\\s*(.*)$`));
    if (!match) {
      return false;
    }
    const value = match[1].replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
    return value.length > 0;
  });
}

function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function windowsCredentialProbeScript(services: readonly string[]): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -TypeDefinition @'",
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class PieceMakerVibeCredential {',
    '  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]',
    '  private struct Credential {',
    '    public int Flags; public int Type; public string TargetName; public string Comment;',
    '    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;',
    '    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;',
    '    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;',
    '  }',
    '  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]',
    '  private static extern bool CredRead(string target, int type, int flags, out IntPtr credential);',
    '  [DllImport("advapi32.dll")]',
    '  private static extern void CredFree(IntPtr credential);',
    '  public static string UserName(string target) {',
    '    IntPtr pointer;',
    '    if (!CredRead(target, 1, 0, out pointer)) { return null; }',
    '    try { return ((Credential)Marshal.PtrToStructure(pointer, typeof(Credential))).UserName; }',
    '    finally { CredFree(pointer); }',
    '  }',
    '}',
    "'@",
    `$variable = ${quotePowerShellLiteral(VIBE_API_KEY_VARIABLE)}`,
    `foreach ($service in @(${services.map(quotePowerShellLiteral).join(', ')})) {`,
    '  if ([PieceMakerVibeCredential]::UserName($service) -eq $variable) { \'found\'; exit 0 }',
    '  if ($null -ne [PieceMakerVibeCredential]::UserName("$variable@$service")) { \'found\'; exit 0 }',
    '}',
    "'missing'",
  ].join('\n');
}

function keyringHasApiKey(host: VibeCliHost): boolean {
  try {
    if (host.platform === 'win32') {
      const encoded = Buffer.from(windowsCredentialProbeScript(host.keyringServices), 'utf16le').toString('base64');
      const result = host.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        encoding: 'utf8',
        timeout: 20000,
        windowsHide: true,
      });
      return !result.error && result.status === 0 && String(result.stdout).trim() === 'found';
    }
    return host.keyringServices.some((service) => {
      const result = host.platform === 'darwin'
        ? host.spawnSync('/usr/bin/security', ['find-generic-password', '-s', service, '-a', VIBE_API_KEY_VARIABLE], { stdio: 'ignore', timeout: 5000 })
        : host.spawnSync('secret-tool', ['lookup', 'service', service, 'username', VIBE_API_KEY_VARIABLE], { stdio: 'ignore', timeout: 5000 });
      return !result.error && result.status === 0;
    });
  } catch {
    return false;
  }
}

export function findVibeApiKey(host: VibeCliHost = currentVibeCliHost()): VibeApiKeySource | null {
  if (readEnv(host, VIBE_API_KEY_VARIABLE)) {
    return 'process_env';
  }
  if (envFileHasApiKey(host)) {
    return 'env_file';
  }
  return keyringHasApiKey(host) ? 'keyring' : null;
}
