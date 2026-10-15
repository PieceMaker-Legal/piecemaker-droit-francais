import assert from 'node:assert/strict';

import { afterEach, beforeEach, test } from 'vitest';

import { inheritSessionPermissionMode } from '@/shared/utils';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

test('a fork copies the source session permission mode', () => {
  localStorage.setItem('permissionMode-source', 'acceptEdits');
  inheritSessionPermissionMode('source', 'fork');
  assert.equal(localStorage.getItem('permissionMode-fork'), 'acceptEdits');
});

test('a fork without a source override writes nothing', () => {
  inheritSessionPermissionMode('source', 'fork');
  assert.equal(localStorage.getItem('permissionMode-fork'), null);
});
