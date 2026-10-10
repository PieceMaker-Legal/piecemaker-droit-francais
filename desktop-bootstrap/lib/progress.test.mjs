import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  finishProgress,
  noteProgress,
  openProgressWindow,
  progressStatusPath,
  progressWindowEnabled,
} from './progress.mjs';
import { ui } from './ui.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-progress-'));
  process.env.PIECEMAKER_BOOTSTRAP_HOME = root;
  process.env.PIECEMAKER_NO_PROGRESS = '1';
  return root;
}

function status() {
  return JSON.parse(fs.readFileSync(progressStatusPath(), 'utf8'));
}

test('PIECEMAKER_NO_PROGRESS désactive la fenêtre', () => {
  process.env.PIECEMAKER_NO_PROGRESS = '1';
  assert.equal(progressWindowEnabled(), false);
});

test("openProgressWindow écrit l'état initial sans lancer de fenêtre", () => {
  sandbox();
  openProgressWindow({ version: 'v2.0.1' });
  const current = status();
  assert.equal(current.state, 'running');
  assert.equal(current.version, 'v2.0.1');
  assert.equal(current.step, 'Démarrage…');
  assert.equal(current.current, 0);
  assert.ok(current.total >= 1);
  assert.equal(current.pid, process.pid);
});

test('ui.step incrémente la barre et ui.ok met à jour le détail', () => {
  sandbox();
  openProgressWindow({ version: 'v2.0.1' });
  ui.step('Compilation du client et du serveur…');
  ui.ok('Client compilé.');
  const current = status();
  assert.equal(current.step, 'Compilation du client et du serveur…');
  assert.equal(current.detail, 'Client compilé.');
  assert.equal(current.current, 1);
  assert.ok(current.current < current.total);
});

test("noteProgress n'atteint pas 100 % avant la fin", () => {
  sandbox();
  openProgressWindow({ version: 'v2.0.1' });
  for (let index = 0; index < 20; index += 1) noteProgress({ step: `Étape ${index}`, increment: true });
  const current = status();
  assert.ok(current.current < current.total);
  finishProgress({ ok: true, message: 'PieceMaker est installé.' });
  const done = JSON.parse(fs.readFileSync(progressStatusPath(), 'utf8'));
  assert.equal(done.state, 'done');
  assert.equal(done.current, done.total);
  assert.equal(done.step, 'PieceMaker est installé.');
});

test("finishProgress en échec conserve le message d'erreur", () => {
  sandbox();
  openProgressWindow({ version: 'v2.0.1' });
  ui.step('Construction de l\'application Electron…');
  finishProgress({ ok: false, error: 'electron-builder a échoué (code 1).' });
  const current = JSON.parse(fs.readFileSync(progressStatusPath(), 'utf8'));
  assert.equal(current.state, 'failed');
  assert.equal(current.error, 'electron-builder a échoué (code 1).');
  assert.equal(current.step, 'Installation interrompue');
});

test('reprend un état déjà écrit par le script d’entrée', () => {
  const root = sandbox();
  fs.writeFileSync(path.join(root, 'progress.json'), `${JSON.stringify({
    state: 'running',
    step: 'Installation d\'un Node.js dédié…',
    detail: '',
    current: 2,
    total: 14,
    version: 'v2.0.1',
    pid: 1,
  })}\n`);
  openProgressWindow({ version: 'v2.0.1' });
  const current = status();
  assert.equal(current.step, 'Installation d\'un Node.js dédié…');
  assert.equal(current.current, 2);
  assert.equal(current.pid, process.pid);
});

test('le script macOS est du Python valide', () => {
  execFileSync('/usr/bin/python3', ['-m', 'py_compile', path.join(here, 'progress-darwin.py')], { stdio: 'ignore' });
});

test('le script Windows lit le fichier d’état', () => {
  const source = fs.readFileSync(path.join(here, 'progress-win32.ps1'), 'utf8');
  assert.match(source, /param\(/);
  assert.match(source, /\$StatusPath/);
  assert.match(source, /System\.Windows\.Forms/);
  assert.match(source, /ProgressBar/);
});
