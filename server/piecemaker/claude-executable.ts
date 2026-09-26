import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

type ClaudeExecutableContext = {
  environment: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  isExecutable(candidate: string): boolean;
  bundledExecutable(): string | null;
};

function isExecutableFile(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function bundledSdkExecutable(): string | null {
  try {
    const packageName = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
    return createRequire(import.meta.url).resolve(`${packageName}/claude`);
  } catch {
    return null;
  }
}

export function claudeExecutableFallback(context: ClaudeExecutableContext): string | null {
  if (context.platform === 'win32' || context.environment.CLAUDE_CLI_PATH) return null;
  const searchPath = (context.environment.PATH || '').split(path.delimiter).filter(Boolean);
  if (searchPath.some((directory) => context.isExecutable(path.join(directory, 'claude')))) return null;
  const bundled = context.bundledExecutable();
  return bundled && context.isExecutable(bundled) ? bundled : null;
}

export function useBundledClaudeWhenMissingFromPath() {
  const fallback = claudeExecutableFallback({
    environment: process.env,
    platform: process.platform,
    isExecutable: isExecutableFile,
    bundledExecutable: bundledSdkExecutable,
  });
  if (fallback) process.env.CLAUDE_CLI_PATH = fallback;
}
