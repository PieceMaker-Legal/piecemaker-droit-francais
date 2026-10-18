import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createUiRuntimeConfig, embedUiRuntimeConfig } from './ui-updates.mjs';

test('macOS and Windows stage the same version-specific signed interface channel', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-ui-stage-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'desktop-bootstrap'), { recursive: true });
  await fs.mkdir(path.join(root, 'stage/electron-piecemaker'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  await fs.writeFile(path.join(root, 'product.config.json'), JSON.stringify({ repository: 'Example/project' }));
  await fs.writeFile(path.join(root, 'desktop-bootstrap/ui-updates.json'), JSON.stringify({ publicKey: 'public key' }));
  const config = await createUiRuntimeConfig(root);
  assert.equal(config.runtime, 'desktop-1.2.3');
  assert.equal(config.feed, 'https://github.com/Example/project/releases/download/ui-desktop-1.2.3');
  await embedUiRuntimeConfig(root, path.join(root, 'stage'));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'stage/electron-piecemaker/ui-update-runtime.json'))), config);
});
