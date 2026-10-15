import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRunPermissionMode } from './permissions.js';

test('le compositeur Contourner gagne pour Codex, Claude et Mistral', () => {
  for (const provider of ['codex', 'claude', 'mistral']) {
    assert.equal(resolveRunPermissionMode(provider, { permissionMode: 'bypassPermissions' }), 'bypassPermissions');
  }
});

test('Réglages Contourner gagne sur acceptEdits pour Codex et Mistral', () => {
  for (const provider of ['codex', 'mistral']) {
    assert.equal(resolveRunPermissionMode(provider, {
      permissionMode: 'acceptEdits',
      toolsSettings: { permissionMode: 'bypassPermissions' },
    }), 'bypassPermissions');
  }
});

test('Réglages Claude skipPermissions contourne si le compositeur est par défaut', () => {
  assert.equal(resolveRunPermissionMode('claude', { permissionMode: 'default', skipPermissions: true }), 'bypassPermissions');
  assert.equal(resolveRunPermissionMode('claude', { permissionMode: 'default', toolsSettings: { skipPermissions: true } }), 'bypassPermissions');
  assert.equal(resolveRunPermissionMode('claude', { permissionMode: 'plan', skipPermissions: true }), 'plan');
  assert.equal(resolveRunPermissionMode('claude', { permissionMode: 'acceptEdits', skipPermissions: false }), 'acceptEdits');
});

test('Réglages Codex Contourner s’applique si le compositeur est par défaut', () => {
  assert.equal(resolveRunPermissionMode('codex', {
    permissionMode: 'default',
    toolsSettings: { permissionMode: 'bypassPermissions' },
  }), 'bypassPermissions');
  assert.equal(resolveRunPermissionMode('codex', {
    permissionMode: 'acceptEdits',
    toolsSettings: { permissionMode: 'bypassPermissions' },
  }), 'bypassPermissions');
  assert.equal(resolveRunPermissionMode('codex', {
    permissionMode: 'plan',
    toolsSettings: { permissionMode: 'bypassPermissions' },
  }), 'plan');
});
