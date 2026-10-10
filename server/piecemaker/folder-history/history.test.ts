import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createFolderHistory } from './history.js';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isolatedHome = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pm-folder-history-home-')));
process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.XDG_CONFIG_HOME = isolatedHome;
test.after(() => rmSync(isolatedHome, { recursive: true, force: true }));

function makeFolder(t: test.TestContext, files: Record<string, string> = {}) {
  const folder = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pm-folder-history-')));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) write(folder, name, content);
  return folder;
}

function write(folder: string, name: string, content: string) {
  mkdirSync(path.dirname(path.join(folder, name)), { recursive: true });
  writeFileSync(path.join(folder, name), content);
}

const git = (folder: string, ...args: string[]) => execFileSync('git', args, { cwd: folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const subjects = (folder: string) => git(folder, 'log', '--format=%s').split('\n').filter(Boolean).reverse();
const filesOf = (folder: string, revision = 'HEAD') => git(folder, 'show', '--name-only', '--format=', revision).split('\n').filter(Boolean).sort();

function makeHistory(t: test.TestContext, options: Parameters<typeof createFolderHistory>[0] = {}) {
  const history = createFolderHistory({ idleDelayMs: 60_000, catchUpDelayMs: 60_000, ...options });
  t.after(() => history.close());
  return history;
}

test('premier tour : état initial, puis un commit de tour ne contenant que le fichier écrit', async (t) => {
  const folder = makeFolder(t, { 'pieces/contrat-fictif.pdf': '%PDF fictif', 'chronologie.md': '# Chronologie', 'notes.md': 'v1' });
  const history = makeHistory(t);
  history.begin(folder);
  await history.idle();
  write(folder, 'notes.md', 'v2');
  history.end({ cwd: folder, request: 'Mets à jour les notes', conclusion: 'J’ai mis à jour les notes.', aborted: false });
  await history.idle();
  assert.deepEqual(subjects(folder), ['État initial du dossier', 'Mets à jour les notes']);
  assert.deepEqual(filesOf(folder), ['notes.md']);
  assert.equal(git(folder, 'log', '-1', '--format=%an <%ae>|%b'), 'PieceMaker <commits@piecemaker.local>|J’ai mis à jour les notes.');
  assert.equal(git(folder, 'remote'), '');
});

test('fichier déjà modifié avant le tour puis modifié par le tour : commit hors IA puis commit du tour', async (t) => {
  const folder = makeFolder(t, { 'notes.md': 'v1' });
  const history = makeHistory(t);
  history.begin(folder);
  history.end({ cwd: folder, request: 'Rien', conclusion: '', aborted: false });
  await history.idle();
  write(folder, 'notes.md', 'v2 avocat');
  history.begin(folder);
  await history.idle();
  write(folder, 'notes.md', 'v3 IA');
  history.end({ cwd: folder, request: 'Complète les notes', conclusion: 'Fait.', aborted: false });
  await history.idle();
  assert.deepEqual(subjects(folder), ['État initial du dossier', 'Modifications hors IA', 'Complète les notes']);
  assert.equal(git(folder, 'show', 'HEAD~1:notes.md'), 'v2 avocat');
  assert.equal(git(folder, 'show', 'HEAD:notes.md'), 'v3 IA');
});

test('mappings, état PieceMaker et verrous Word ne sont jamais versionnés', async (t) => {
  const folder = makeFolder(t, {
    'notes.md': 'notes',
    'mapping_default.json': '{}',
    'scan_sensitive_map.json': '{}',
    '.piecemaker/state.json': '{}',
    '~$acte.docx': 'verrou',
    '.env': 'CLE=fictive',
  });
  const history = makeHistory(t);
  history.begin(folder);
  history.end({ cwd: folder, request: 'Tour', conclusion: '', aborted: false });
  await history.idle();
  assert.equal(git(folder, 'ls-files'), 'notes.md');
});

test('dossier dans un dépôt parent ou dépôt créé par l’utilisateur : rien n’est touché', async (t) => {
  const parent = makeFolder(t, { 'code.ts': 'export {}' });
  git(parent, 'init', '--quiet');
  const nested = path.join(parent, 'dossier');
  write(parent, 'dossier/notes.md', 'notes');
  const own = makeFolder(t, { 'notes.md': 'notes' });
  git(own, 'init', '--quiet');
  git(own, 'add', 'notes.md');
  const history = makeHistory(t);
  for (const folder of [nested, own]) {
    history.begin(folder);
    write(folder, 'notes.md', 'modifié');
    history.end({ cwd: folder, request: 'Tour', conclusion: '', aborted: false });
  }
  await history.idle();
  for (const folder of [parent, own]) {
    assert.throws(() => git(folder, 'rev-parse', '--verify', '--quiet', 'HEAD'));
  }
  assert.equal(git(nested, 'rev-parse', '--show-toplevel'), parent);
});

test('dépôt vide créé avant PieceMaker (« Initialiser ») : repris et versionné', async (t) => {
  const folder = makeFolder(t, { 'notes.md': 'v1' });
  git(folder, 'init', '--quiet');
  const history = makeHistory(t);
  history.begin(folder);
  await history.idle();
  write(folder, 'notes.md', 'v2');
  history.end({ cwd: folder, request: 'Tour', conclusion: '', aborted: false });
  await history.idle();
  assert.deepEqual(subjects(folder), ['État initial du dossier', 'Tour']);
});

test('tour aborté ou sans écriture : aucun commit de tour', async (t) => {
  const folder = makeFolder(t, { 'notes.md': 'v1' });
  const history = makeHistory(t);
  history.begin(folder);
  history.end({ cwd: folder, request: 'Sans écriture', conclusion: '', aborted: false });
  history.begin(folder);
  await history.idle();
  write(folder, 'notes.md', 'écrit avant l’abandon');
  history.end({ cwd: folder, request: 'Aborté', conclusion: '', aborted: true });
  await history.idle();
  assert.deepEqual(subjects(folder), ['État initial du dossier']);
});

test('performance : begin et end rendent la main immédiatement pendant un commit initial volumineux', async (t) => {
  const files: Record<string, string> = {};
  for (let index = 0; index < 300; index += 1) files[`pieces/piece-${index}.md`] = `Pièce fictive ${index}\n`.repeat(200);
  const folder = makeFolder(t, files);
  write(folder, 'pieces/gros-fictif.pdf', 'x'.repeat(5 * 1024 * 1024));
  const history = makeHistory(t);
  const started = performance.now();
  history.begin(folder);
  history.end({ cwd: folder, request: 'Tour', conclusion: '', aborted: false });
  assert.ok(performance.now() - started < 5, `${performance.now() - started} ms`);
  await history.idle();
  assert.deepEqual(subjects(folder), ['État initial du dossier']);
});

test('surveillance : ajouts et modifications de l’avocat regroupés en un seul commit hors IA', async (t) => {
  const folder = makeFolder(t, { 'notes.md': 'v1' });
  const history = makeHistory(t, { idleDelayMs: 300 });
  history.begin(folder);
  history.end({ cwd: folder, request: 'Tour', conclusion: '', aborted: false });
  await history.idle();
  history.syncFolders([folder]);
  await pause(100);
  for (let index = 0; index < 5; index += 1) {
    write(folder, 'notes.md', `v${index + 2}`);
    await pause(30);
  }
  write(folder, 'pieces/contrat-fictif.pdf', '%PDF fictif');
  await pause(900);
  await history.idle();
  assert.deepEqual(subjects(folder), ['État initial du dossier', 'Modifications hors IA']);
  assert.deepEqual(filesOf(folder), ['notes.md', 'pieces/contrat-fictif.pdf']);
  assert.equal(git(folder, 'log', '-1', '--format=%b'), 'M\tnotes.md\nA\tpieces/contrat-fictif.pdf');
});

test('surveillance : une écriture pendant un tour actif va dans le commit du tour', async (t) => {
  const folder = makeFolder(t, { 'notes.md': 'v1' });
  const history = makeHistory(t, { idleDelayMs: 200 });
  history.syncFolders([folder]);
  history.begin(folder);
  await history.idle();
  await pause(100);
  write(folder, 'notes.md', 'v2 IA');
  await pause(600);
  history.end({ cwd: folder, request: 'Tour IA fictif', conclusion: '', aborted: false });
  await history.idle();
  await pause(400);
  await history.idle();
  assert.deepEqual(subjects(folder), ['État initial du dossier', 'Tour IA fictif']);
});

test('rattrapage au démarrage : les modifications faites serveur arrêté sont commitées', async (t) => {
  const folder = makeFolder(t, { 'notes.md': 'v1' });
  const untouched = makeFolder(t, { 'notes.md': 'jamais versionné' });
  const first = makeHistory(t);
  first.begin(folder);
  first.end({ cwd: folder, request: 'Tour', conclusion: '', aborted: false });
  await first.idle();
  first.close();
  write(folder, 'notes.md', 'modifié pendant l’arrêt');
  const second = makeHistory(t, { catchUpDelayMs: 50 });
  second.syncFolders([folder, untouched]);
  await pause(200);
  await second.idle();
  assert.deepEqual(subjects(folder), ['État initial du dossier', 'Modifications hors IA']);
  assert.throws(() => git(untouched, 'rev-parse', '--git-dir'));
});
