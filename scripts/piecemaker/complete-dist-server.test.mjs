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

test('the compiled server loads every plain script from the sources, next to its data files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'complete-dist-'));
  const dist = path.join(root, 'dist-server');
  write(path.join(root, 'lib', 'doc.mjs'), "import data from './data.json' with { type: 'json' };\n");
  write(path.join(dist, 'lib', 'kept.mjs'), '');
  write(path.join(root, 'lib', 'compiled.js'), '');
  write(path.join(dist, 'lib', 'compiled.js'), '');
  write(path.join(root, 'server', 'piecemaker', 'vendor', 'herisson.mjs'), '');
  write(path.join(dist, 'server', 'piecemaker', 'vendor', 'herisson.mjs'), '');
  const compiled = path.join(dist, 'shared', 'sources.js');
  write(compiled, "import { doc } from '../lib/doc.mjs';\nimport k from '../lib/kept.mjs';\nimport a from '../lib/compiled.js';\nimport h from '../server/piecemaker/vendor/herisson.mjs';\nimport x from '../lib/absent.mjs';\n");
  assert.deepEqual(completeDistServer(root, dist), [path.join('lib', 'doc.mjs'), path.join('server', 'piecemaker', 'vendor', 'herisson.mjs')]);
  assert.equal(fs.readFileSync(compiled, 'utf8'), "import { doc } from '../../lib/doc.mjs';\nimport k from '../lib/kept.mjs';\nimport a from '../lib/compiled.js';\nimport h from '../../server/piecemaker/vendor/herisson.mjs';\nimport x from '../lib/absent.mjs';\n");
  assert.deepEqual(completeDistServer(root, dist), []);
  fs.rmSync(root, { recursive: true, force: true });
});
