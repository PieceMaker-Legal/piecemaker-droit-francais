import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { addEmbeddedNode } from './embedded-node.js';

const resourcesPath = path.join('C:', 'Program Files', 'PieceMaker', 'resources');
const shimDirectory = path.join(resourcesPath, 'node-shim');

test('adds the node shim after the existing PATH so an installed Node keeps priority', () => {
  const environment = { PATH: 'C:\\Windows\\System32' };
  assert.equal(addEmbeddedNode({ resourcesPath, environment, exists: (file) => file === path.join(shimDirectory, 'node.cmd') }), true);
  assert.equal(environment.PATH, `C:\\Windows\\System32${path.delimiter}${shimDirectory}`);
});

test('leaves PATH alone when the app ships no node shim', () => {
  const environment = { PATH: 'C:\\Windows\\System32' };
  assert.equal(addEmbeddedNode({ resourcesPath, environment, exists: () => false }), false);
  assert.equal(addEmbeddedNode({ resourcesPath: '', environment, exists: () => true }), false);
  assert.equal(environment.PATH, 'C:\\Windows\\System32');
});
