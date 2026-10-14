import assert from 'node:assert/strict';
import test from 'node:test';

import { configureWindowsUpdates } from './windows-update-config.mjs';

test('Windows packaging publishes an NSIS update feed for the product repository', () => {
  const manifest = { build: { win: { target: ['nsis'], icon: 'product.ico' }, nsis: {} } };
  configureWindowsUpdates(manifest, 'Example/Product', true);
  assert.deepEqual(manifest.build.publish, [{ provider: 'github', owner: 'Example', repo: 'Product', releaseType: 'release' }]);
  assert.equal(manifest.build.win.verifyUpdateCodeSignature, true);
  assert.deepEqual(manifest.build.win.target, ['nsis']);
  assert.equal(manifest.build.nsis.perMachine, false);
  assert.equal(manifest.build.nsis.runAfterFinish, false);
});

test('unsigned builds explicitly retain the existing unsigned release policy', () => {
  const manifest = { build: { win: {}, nsis: {} } };
  configureWindowsUpdates(manifest, 'Example/Product', false);
  assert.equal(manifest.build.win.verifyUpdateCodeSignature, false);
});
