import assert from 'node:assert/strict';
import test from 'node:test';

import { configureWindowsUpdates } from './windows-update-config.mjs';

test('Windows packaging publishes an NSIS update feed for the product repository', () => {
  const manifest = { build: { win: { target: ['nsis'], icon: 'product.ico' }, nsis: { installerIcon: 'cloudcli.ico', uninstallerIcon: 'cloudcli.ico' } } };
  configureWindowsUpdates(manifest, 'Example/Product', true, 'server/piecemaker/vendor/installer/assets/piecemaker.ico');
  assert.deepEqual(manifest.build.publish, [{ provider: 'github', owner: 'Example', repo: 'Product', releaseType: 'release' }]);
  assert.equal(manifest.build.win.verifyUpdateCodeSignature, true);
  assert.deepEqual(manifest.build.win.target, ['nsis']);
  assert.equal(manifest.build.nsis.perMachine, false);
  assert.equal(manifest.build.nsis.runAfterFinish, false);
  assert.equal(manifest.build.nsis.installerIcon, 'server/piecemaker/vendor/installer/assets/piecemaker.ico');
  assert.equal(manifest.build.nsis.uninstallerIcon, 'server/piecemaker/vendor/installer/assets/piecemaker.ico');
});

test('unsigned builds explicitly retain the existing unsigned release policy', () => {
  const manifest = { build: { win: {}, nsis: {} } };
  configureWindowsUpdates(manifest, 'Example/Product', false, 'server/piecemaker/vendor/installer/assets/piecemaker.ico');
  assert.equal(manifest.build.win.verifyUpdateCodeSignature, false);
});
