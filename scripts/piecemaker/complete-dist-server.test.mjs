import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { completeDistServer } from './complete-dist-server.mjs';

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test('the compiled server loads the untyped scripts tsc left out from the sources', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'complete-dist-'));
  const dist = path.join(root, 'dist-server');
  write(path.join(root, 'lib', 'doc.mjs'), "import data from './data.json' with { type: 'json' };\n");
  write(path.join(dist, 'lib', 'kept.mjs'), '');
  const compiled = path.join(dist, 'shared', 'sources.js');
  write(compiled, "import { doc } from '../lib/doc.mjs';\nimport k from '../lib/kept.mjs';\nimport x from '../lib/absent.mjs';\n");
  assert.deepEqual(completeDistServer(root, dist), [path.join('lib', 'doc.mjs')]);
  assert.equal(fs.readFileSync(compiled, 'utf8'), "import { doc } from '../../lib/doc.mjs';\nimport k from '../lib/kept.mjs';\nimport x from '../lib/absent.mjs';\n");
  assert.deepEqual(completeDistServer(root, dist), []);
  fs.rmSync(root, { recursive: true, force: true });
});
