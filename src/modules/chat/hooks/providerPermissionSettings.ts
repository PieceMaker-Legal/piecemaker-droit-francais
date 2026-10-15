import { PROVIDER_PERMISSION_PREFERENCE_KEYS } from '@/shared/constants';
import type { LLMProvider, PermissionMode } from '@/shared/types';
import { readUserPreference } from '@/shared/userSettings';

type StoredPermissions = {
  skipPermissions?: unknown;
  permissionMode?: unknown;
};

type ComposerPermissionSources = {
  sessionSavedMode: PermissionMode | null;
  newChatMode: PermissionMode | null;
  settingsMode: PermissionMode | null;
  providerSavedMode: PermissionMode | null;
  validModes: PermissionMode[];
  fallback: PermissionMode;
};

/** sessionStorage key for a mode picked in a brand-new chat before its first send. */
export const newChatPermissionModeKey = (provider: LLMProvider): string => (
  `permissionMode-new-${provider}`
);

/** Used by chat provider state to seed the composer from Réglages when a session has no override. */
export function permissionModeFromSettings(provider: LLMProvider): PermissionMode | null {
  const stored = readUserPreference<StoredPermissions>(PROVIDER_PERMISSION_PREFERENCE_KEYS[provider], {});
  if (provider === 'claude' || provider === 'cursor') {
    return stored.skipPermissions === true ? 'bypassPermissions' : null;
  }
  const mode = stored.permissionMode;
  if (mode === 'default' || mode === 'acceptEdits' || mode === 'bypassPermissions' || mode === 'plan') {
    return mode;
  }
  return null;
}

/**
 * Used by chat provider state. Same order as CloudCLI #1417: the session
 * override, then a pre-send pick, then Réglages, then the last pick for this
 * provider.
 */
export function resolveComposerPermissionMode({
  sessionSavedMode,
  newChatMode,
  settingsMode,
  providerSavedMode,
  validModes,
  fallback,
}: ComposerPermissionSources): PermissionMode {
  const allowed = (mode: PermissionMode | null): mode is PermissionMode =>
    Boolean(mode && validModes.includes(mode));
  const savedMode = [sessionSavedMode, newChatMode, settingsMode, providerSavedMode].find(allowed);
  return savedMode ?? fallback;
}
