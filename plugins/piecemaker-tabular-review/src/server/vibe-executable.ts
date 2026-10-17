import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type VibeLookup = {
  environment?: NodeJS.ProcessEnv;
  homedir?: string;
  platform?: NodeJS.Platform;
  existsSync?: (filePath: string) => boolean;
};

function environmentValue(environment: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string | undefined {
  const key = Object.keys(environment).find((candidate) => (
    platform === 'win32' ? candidate.toLowerCase() === name.toLowerCase() : candidate === name
  ));
  return (key ? environment[key]?.trim() : undefined) || undefined;
}

export function vibeExecutable(configured: string | null | undefined, lookup: VibeLookup = {}): string {
  if (configured) return configured;
  const environment = lookup.environment ?? process.env;
  const platform = lookup.platform ?? process.platform;
  const homedir = lookup.homedir ?? os.homedir();
  const existsSync = lookup.existsSync ?? fs.existsSync;
  const api = platform === 'win32' ? path.win32 : path.posix;
  const expand = (value: string) => api.resolve(value.replace(/^~(?=$|[\\/])/, homedir));
  const piecemakerHome = environmentValue(environment, 'PIECEMAKER_HOME', platform);
  const uvToolBin = environmentValue(environment, 'UV_TOOL_BIN_DIR', platform);
  const xdgBin = environmentValue(environment, 'XDG_BIN_HOME', platform);
  const xdgData = environmentValue(environment, 'XDG_DATA_HOME', platform);
  const executable = platform === 'win32' ? 'vibe.exe' : 'vibe';
  const directories = [
    uvToolBin ? expand(uvToolBin) : '',
    xdgBin ? expand(xdgBin) : '',
    xdgData ? api.resolve(expand(xdgData), '..', 'bin') : '',
    api.join(homedir, '.local', 'bin'),
    api.join(piecemakerHome ? expand(piecemakerHome) : api.join(homedir, '.piecemaker'), 'vibe', platform === 'win32' ? 'Scripts' : 'bin'),
  ].filter((directory, index, all) => directory && all.indexOf(directory) === index);
  const directory = directories.find((candidate) => existsSync(api.join(candidate, executable)));
  return directory ? api.join(directory, executable) : 'vibe';
}
