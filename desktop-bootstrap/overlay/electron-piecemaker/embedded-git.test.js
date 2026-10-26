import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { addEmbeddedGit } from './embedded-git.js';

const resourcesPath = path.join('C:', 'Program Files', 'PieceMaker', 'resources');
const gitDirectory = path.join(resourcesPath, 'mingit', 'cmd');

test('puts the embedded Git first on PATH', () => {
  const environment = { PATH: 'C:\\Windows\\System32' };
  assert.equal(addEmbeddedGit({ resourcesPath, environment, exists: (file) => file === path.join(gitDirectory, 'git.exe') }), true);
  assert.equal(environment.PATH, `${gitDirectory}${path.delimiter}C:\\Windows\\System32`);
});

test('leaves PATH alone when the app ships no Git', () => {
  const environment = { PATH: 'C:\\Windows\\System32' };
  assert.equal(addEmbeddedGit({ resourcesPath, environment, exists: () => false }), false);
  assert.equal(addEmbeddedGit({ resourcesPath: '', environment, exists: () => true }), false);
  assert.equal(environment.PATH, 'C:\\Windows\\System32');
});
