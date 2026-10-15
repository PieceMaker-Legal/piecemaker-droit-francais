import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRunPermissionMode } from './permissions.js';

const COMPOSER_MODES = ['default', 'auto', 'acceptEdits', 'bypassPermissions', 'plan'];

test('le compositeur envoie chaque mode tel quel pour Codex, Claude et Mistral', () => {
  for (const provider of ['codex', 'claude', 'mistral']) {
    for (const mode of COMPOSER_MODES) {
      assert.equal(resolveRunPermissionMode(provider, { permissionMode: mode }), mode);
    }
  }
});

test('Réglages Claude skipPermissions ne remplace que le mode par défaut', () => {
  assert.equal(resolveRunPermissionMode('claude', { permissionMode: 'default', skipPermissions: true }), 'bypassPermissions');
  assert.equal(resolveRunPermissionMode('claude', { permissionMode: 'default', toolsSettings: { skipPermissions: true } }), 'bypassPermissions');
  assert.equal(resolveRunPermissionMode('claude', { permissionMode: 'plan', skipPermissions: true }), 'plan');
  assert.equal(resolveRunPermissionMode('claude', { permissionMode: 'acceptEdits', skipPermissions: true }), 'acceptEdits');
  assert.equal(resolveRunPermissionMode('claude', { permissionMode: 'auto', skipPermissions: true }), 'auto');
});

test('Réglages Codex ne remplace que le mode par défaut', () => {
  assert.equal(resolveRunPermissionMode('codex', {
    permissionMode: 'default',
    toolsSettings: { permissionMode: 'bypassPermissions' },
  }), 'bypassPermissions');
  assert.equal(resolveRunPermissionMode('codex', {
    permissionMode: 'acceptEdits',
    toolsSettings: { permissionMode: 'bypassPermissions' },
  }), 'acceptEdits');
  assert.equal(resolveRunPermissionMode('codex', {
    permissionMode: 'plan',
    toolsSettings: { permissionMode: 'bypassPermissions' },
  }), 'plan');
});
