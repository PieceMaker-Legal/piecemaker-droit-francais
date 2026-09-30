import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { replaceDirectory, stopProcessesScript } from './place.mjs';

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-place-'));
  const source = path.join(root, 'build');
  const destination = path.join(root, 'Programs', 'PieceMaker');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'version.txt'), 'nouvelle');
  return { root, source, destination };
}

function install(destination, version) {
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'version.txt'), version);
}

const copy = (from, to) => fs.promises.cp(from, to, { recursive: true });

test('remplace la version installée sans laisser de copie de l\'ancienne', async () => {
  const { source, destination } = sandbox();
  install(destination, 'ancienne');
  fs.writeFileSync(path.join(destination, 'obsolete.txt'), '');
  await replaceDirectory(source, destination, copy);
  assert.equal(fs.readFileSync(path.join(destination, 'version.txt'), 'utf8'), 'nouvelle');
  assert.equal(fs.existsSync(path.join(destination, 'obsolete.txt')), false);
  assert.deepEqual(fs.readdirSync(path.dirname(destination)), ['PieceMaker']);
});

test('installe quand rien n\'est encore en place et purge une ancienne copie oubliée', async () => {
  const { source, destination } = sandbox();
  install(path.join(path.dirname(destination), '.PieceMaker.previous'), 'oubliee');
  await replaceDirectory(source, destination, copy);
  assert.equal(fs.readFileSync(path.join(destination, 'version.txt'), 'utf8'), 'nouvelle');
  assert.deepEqual(fs.readdirSync(path.dirname(destination)), ['PieceMaker']);
});

test('restaure la version installée si la copie échoue', async () => {
  const { source, destination } = sandbox();
  install(destination, 'ancienne');
  const failingCopy = async (from, to) => {
    fs.mkdirSync(to);
    fs.writeFileSync(path.join(to, 'partiel.txt'), '');
    throw new Error('disque plein');
  };
  await assert.rejects(replaceDirectory(source, destination, failingCopy), /disque plein/);
  assert.equal(fs.readFileSync(path.join(destination, 'version.txt'), 'utf8'), 'ancienne');
  assert.deepEqual(fs.readdirSync(destination), ['version.txt']);
  assert.deepEqual(fs.readdirSync(path.dirname(destination)), ['PieceMaker']);
});

test('refuse sans rien toucher quand la version installée ne peut pas être déplacée', {
  skip: process.platform === 'win32' || process.getuid?.() === 0,
}, async () => {
  const { source, destination } = sandbox();
  install(destination, 'ancienne');
  const parent = path.dirname(destination);
  fs.chmodSync(parent, 0o555);
  try {
    await assert.rejects(
      replaceDirectory(source, destination, copy, { attempts: 2, delayMs: 1 }),
      /encore utilisé .*fermez PieceMaker/,
    );
  } finally {
    fs.chmodSync(parent, 0o755);
  }
  assert.equal(fs.readFileSync(path.join(destination, 'version.txt'), 'utf8'), 'ancienne');
});

test('ne ferme sous Windows que les processus lancés depuis le dossier de l\'application', () => {
  const script = stopProcessesScript("C:\\Users\\d'Ada\\AppData\\Local\\Programs\\PieceMaker");
  assert.match(script, /StartsWith\('C:\\Users\\d''Ada\\AppData\\Local\\Programs\\PieceMaker\\', \[StringComparison\]::OrdinalIgnoreCase\)/);
  assert.ok(script.indexOf('CloseMainWindow') < script.indexOf('Stop-Process'));
  assert.match(script, /\$found\.Count$/);
});
