import assert from 'node:assert/strict';

import { afterEach, beforeEach, test } from 'vitest';

import { permissionModeFromSettings, resolveComposerPermissionMode } from '@/modules/chat/hooks/providerPermissionSettings';
import type { PermissionMode } from '@/shared/types';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';

beforeEach(() => {
  resetUserPreferences();
  localStorage.clear();
});

afterEach(() => {
  resetUserPreferences();
  localStorage.clear();
});

test('Claude and Cursor map skipPermissions onto bypassPermissions', () => {
  writeUserPreference('claudePermissions', { skipPermissions: true });
  writeUserPreference('cursorPermissions', { skipPermissions: true });
  assert.equal(permissionModeFromSettings('claude'), 'bypassPermissions');
  assert.equal(permissionModeFromSettings('cursor'), 'bypassPermissions');
});

test('Codex and Mistral read the stored permissionMode', () => {
  writeUserPreference('codexPermissions', { permissionMode: 'bypassPermissions' });
  writeUserPreference('mistralPermissions', { permissionMode: 'acceptEdits' });
  assert.equal(permissionModeFromSettings('codex'), 'bypassPermissions');
  assert.equal(permissionModeFromSettings('mistral'), 'acceptEdits');
});

test('unset provider settings do not invent a mode', () => {
  assert.equal(permissionModeFromSettings('claude'), null);
  assert.equal(permissionModeFromSettings('codex'), null);
  assert.equal(permissionModeFromSettings('mistral'), null);
});

const MODES: PermissionMode[] = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];

test('an explicit session mode wins over Réglages (CloudCLI #1417)', () => {
  for (const sessionSavedMode of MODES) {
    assert.equal(resolveComposerPermissionMode({
      sessionSavedMode,
      newChatMode: 'plan',
      settingsMode: 'bypassPermissions',
      providerSavedMode: 'default',
      validModes: MODES,
      fallback: 'default',
    }), sessionSavedMode);
  }
});

test('a pre-send pick wins over Réglages when the session has no override', () => {
  assert.equal(resolveComposerPermissionMode({
    sessionSavedMode: null,
    newChatMode: 'acceptEdits',
    settingsMode: 'bypassPermissions',
    providerSavedMode: 'default',
    validModes: MODES,
    fallback: 'default',
  }), 'acceptEdits');
});

test('Réglages wins over the last provider pick when the session has no override', () => {
  assert.equal(resolveComposerPermissionMode({
    sessionSavedMode: null,
    newChatMode: null,
    settingsMode: 'acceptEdits',
    providerSavedMode: 'bypassPermissions',
    validModes: MODES,
    fallback: 'default',
  }), 'acceptEdits');
});

test('session bypass is kept when Réglages is unset', () => {
  assert.equal(resolveComposerPermissionMode({
    sessionSavedMode: 'bypassPermissions',
    newChatMode: null,
    settingsMode: null,
    providerSavedMode: 'acceptEdits',
    validModes: MODES,
    fallback: 'default',
  }), 'bypassPermissions');
});
