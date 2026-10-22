import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initialPreparationNeeded } from './compact-runtime.mjs';

test('a different Python manifest triggers preparation even when a working interpreter exists', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-python-update-'));
  const previous = process.env.PIECEMAKER_HOME;
  process.env.PIECEMAKER_HOME = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.PIECEMAKER_HOME;
    else process.env.PIECEMAKER_HOME = previous;
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(root, 'certs'));
  const pythonPath = path.join(root, 'python.exe');
  for (const file of [pythonPath, path.join(root, 'certs/piecemaker-ca.crt'), path.join(root, 'certs/piecemaker-ca.key')]) await fs.writeFile(file, '');
  await fs.writeFile(path.join(root, 'python-runtime.json'), JSON.stringify({ requirementsSha256: 'new' }));
  await fs.writeFile(path.join(root, 'config.json'), JSON.stringify({ pythonPath }));
  assert.equal(initialPreparationNeeded(root), true);
  await fs.writeFile(path.join(root, 'config.json'), JSON.stringify({ pythonPath, pythonRuntime: { kind: 'shared', requirementsSha256: 'old' } }));
  assert.equal(initialPreparationNeeded(root), true);
  await fs.writeFile(path.join(root, 'config.json'), JSON.stringify({ pythonPath, pythonRuntime: { kind: 'shared', requirementsSha256: 'new' } }));
  assert.equal(initialPreparationNeeded(root), false);
  await fs.writeFile(path.join(root, 'python-runtime.json'), JSON.stringify({ requirementsSha256: 'new', sha256: 'different-interpreter' }));
  assert.equal(initialPreparationNeeded(root), true);
});
