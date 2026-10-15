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

test('Réglages Contourner wins over a stale session acceptEdits', () => {
  assert.equal(resolveComposerPermissionMode({
    sessionSavedMode: 'acceptEdits',
    settingsMode: 'bypassPermissions',
    providerSavedMode: 'default',
    validModes: MODES,
    fallback: 'default',
  }), 'bypassPermissions');
});

test('an explicit session plan still wins over Réglages Contourner', () => {
  assert.equal(resolveComposerPermissionMode({
    sessionSavedMode: 'plan',
    settingsMode: 'bypassPermissions',
    providerSavedMode: 'acceptEdits',
    validModes: MODES,
    fallback: 'default',
  }), 'plan');
});

test('session bypass is kept when Réglages is unset', () => {
  assert.equal(resolveComposerPermissionMode({
    sessionSavedMode: 'bypassPermissions',
    settingsMode: null,
    providerSavedMode: 'acceptEdits',
    validModes: MODES,
    fallback: 'default',
  }), 'bypassPermissions');
});
