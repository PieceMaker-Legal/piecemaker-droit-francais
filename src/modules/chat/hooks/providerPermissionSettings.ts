import { PROVIDER_PERMISSION_PREFERENCE_KEYS } from '@/shared/constants';
import type { LLMProvider, PermissionMode } from '@/shared/types';
import { readUserPreference } from '@/shared/userSettings';

type StoredPermissions = {
  skipPermissions?: unknown;
  permissionMode?: unknown;
};

type ComposerPermissionSources = {
  sessionSavedMode: PermissionMode | null;
  settingsMode: PermissionMode | null;
  providerSavedMode: PermissionMode | null;
  validModes: PermissionMode[];
  fallback: PermissionMode;
};

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
 * Used by chat provider state. Réglages « Contourner » wins over a stale
 * session acceptEdits/default; an explicit session plan still wins.
 */
export function resolveComposerPermissionMode({
  sessionSavedMode,
  settingsMode,
  providerSavedMode,
  validModes,
  fallback,
}: ComposerPermissionSources): PermissionMode {
  const allowed = (mode: PermissionMode | null): mode is PermissionMode =>
    Boolean(mode && validModes.includes(mode));
  if (allowed(sessionSavedMode) && sessionSavedMode === 'plan') {
    return sessionSavedMode;
  }
  if (allowed(settingsMode) && settingsMode === 'bypassPermissions') {
    return settingsMode;
  }
  const savedMode = [sessionSavedMode, settingsMode, providerSavedMode].find(allowed);
  return savedMode ?? fallback;
}
