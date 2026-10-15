type RunOptions = {
  permissionMode?: unknown;
  skipPermissions?: unknown;
  toolsSettings?: unknown;
};

function storedPermissions(value: unknown): { skipPermissions?: unknown; permissionMode?: unknown } {
  return value && typeof value === 'object' ? value as { skipPermissions?: unknown; permissionMode?: unknown } : {};
}

export function resolveRunPermissionMode(provider: string, options: RunOptions): string {
  const requested = typeof options.permissionMode === 'string' ? options.permissionMode : '';
  if (requested) return requested;
  const stored = storedPermissions(options.toolsSettings);
  const skip = options.skipPermissions === true || stored.skipPermissions === true;
  if ((provider === 'claude' || provider === 'cursor') && skip) return 'bypassPermissions';
  if (stored.permissionMode === 'bypassPermissions') return 'bypassPermissions';
  return 'default';
}
