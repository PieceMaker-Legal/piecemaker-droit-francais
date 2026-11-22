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

test('the compiled server gets the untyped scripts it imports, transitively', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'complete-dist-'));
  const dist = path.join(root, 'dist-server');
  write(path.join(root, 'lib', 'doc.mjs'), "import { a } from './paths.cjs';\n");
  write(path.join(root, 'lib', 'paths.cjs'), "module.exports = require('./base.cjs');\n");
  write(path.join(root, 'lib', 'base.cjs'), 'module.exports = {};\n');
  write(path.join(dist, 'shared', 'sources.js'), "import { doc } from '../lib/doc.mjs';\nimport x from '../lib/absent.mjs';\n");
  assert.deepEqual(completeDistServer(root, dist).sort(), ['lib/base.cjs', 'lib/doc.mjs', 'lib/paths.cjs']);
  assert.deepEqual(completeDistServer(root, dist), []);
  fs.rmSync(root, { recursive: true, force: true });
});
