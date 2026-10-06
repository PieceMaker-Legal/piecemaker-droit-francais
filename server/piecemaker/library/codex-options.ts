import path from 'node:path';

import type { CodexOptions } from '@openai/codex-sdk';

export function buildCodexClientOptions(libraryDisabledSkills: unknown): CodexOptions | undefined {
  const paths = Array.isArray(libraryDisabledSkills)
    ? libraryDisabledSkills.map((skill) => (skill as { path?: unknown } | null)?.path).filter((file): file is string => typeof file === 'string' && path.isAbsolute(file))
    : [];
  if (!paths.length) return undefined;
  return { config: { skills: { config: [...new Set(paths)].map((file) => ({ path: file, enabled: false })) } } };
}
