import path from 'node:path';

import type { CodexOptions } from '@openai/codex-sdk';

export function buildCodexClientOptions(libraryDisabledSkills: unknown, permissionMode?: string): CodexOptions {
  const paths = Array.isArray(libraryDisabledSkills)
    ? libraryDisabledSkills.map((skill) => (skill as { path?: unknown } | null)?.path).filter((file): file is string => typeof file === 'string' && path.isAbsolute(file))
    : [];
  const skills = paths.length
    ? { skills: { config: [...new Set(paths)].map((file) => ({ path: file, enabled: false })) } }
    : {};
  const modeConfig = permissionMode === 'bypassPermissions'
    ? { sandbox_mode: 'danger-full-access', approval_policy: 'never' }
    : permissionMode === 'plan'
      ? { sandbox_mode: 'read-only', approval_policy: 'never' }
      : permissionMode === 'acceptEdits'
        ? { sandbox_mode: 'workspace-write', approval_policy: 'never' }
        : {};
  return { config: { sandbox_workspace_write: { network_access: true }, ...modeConfig, ...skills } };
}
