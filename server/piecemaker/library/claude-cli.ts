import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';

export type ClaudeCommandResult = { ok: boolean; output: string; status: number | null };

export function bundledClaudeExecutable(appData: string | undefined): string | null {
  if (!appData) return null;
  const root = path.join(appData, 'Claude', 'claude-code');
  let versions: string[];
  try { versions = fs.readdirSync(root).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); }
  catch { return null; }
  for (const version of versions) {
    let builds: string[];
    try { builds = fs.readdirSync(path.join(root, version)); }
    catch { continue; }
    for (const build of builds) {
      const candidate = path.join(root, version, build, 'claude.exe');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function claudeExecutable(): string {
  return resolveClaudeCodeExecutablePath()
    ?? (process.platform === 'win32' ? bundledClaudeExecutable(process.env.APPDATA) : null)
    ?? 'claude';
}

export function runClaudeCommand(command: string, args: string[], timeout = 60000): ClaudeCommandResult {
  const executable = command === 'claude' ? claudeExecutable() : command;
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  if (result.error) return { ok: false, output: result.error.message, status: null };
  return { ok: result.status === 0, output: `${result.stdout || ''}${result.stderr || ''}`, status: result.status };
}
