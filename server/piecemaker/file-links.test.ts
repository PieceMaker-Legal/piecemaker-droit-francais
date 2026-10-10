import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

import express from 'express';

import { createExternalFileRouter, createFileLinksRouter, normalizeFileRef, resolveFileRef } from './file-links.js';

let base = '';
let project = '';
let home = '';
let outside = '';

before(async () => {
  base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'pm-file-links-')));
  project = path.join(base, 'dossier');
  home = path.join(base, 'home');
  outside = path.join(base, 'ailleurs');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await mkdir(path.join(project, 'a'), { recursive: true });
  await mkdir(path.join(project, 'b'), { recursive: true });
  await mkdir(path.join(project, 'node_modules', 'x'), { recursive: true });
  await mkdir(path.join(home, 'Desktop'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(project, 'src', 'note.md'), '# Note');
  await writeFile(path.join(project, 'a', 'unique.docx'), 'docx');
  await writeFile(path.join(project, 'a', 'double.md'), 'a');
  await writeFile(path.join(project, 'b', 'double.md'), 'b');
  await writeFile(path.join(project, 'node_modules', 'x', 'cache.md'), 'x');
  await writeFile(path.join(home, 'Desktop', '01 - Modèle Assignation.docx'), 'docx');
  await writeFile(path.join(outside, 'piece.txt'), 'avant');
  await symlink(path.join(project, 'absent.md'), path.join(project, 'casse.md'));
  await symlink(path.join(project, 'src'), path.join(project, 'vers-dossier.md'));
});

after(async () => {
  await rm(base, { recursive: true, force: true });
});

const resolve = (ref: string) => resolveFileRef(project, ref, home);

test('retire les suffixes de position reconnus', () => {
  for (const ref of ['src/note.md:12', 'src/note.md:12:3', 'src/note.md:line 12, column 3', 'src/note.md#L12', 'src/note.md#L12-34', 'src/note.md#L12-L34']) {
    assert.equal(normalizeFileRef(ref, home), 'src/note.md', ref);
  }
  assert.equal(normalizeFileRef('~/Desktop/x.docx', home), path.join(home, 'Desktop', 'x.docx'));
});

test('vérifie un chemin relatif, absolu, ~ ou file://', async () => {
  const note = path.join(project, 'src', 'note.md');
  assert.equal(await resolve('src/note.md:12'), note);
  assert.equal(await resolve(note), note);
  assert.equal(await resolve(pathToFileURL(note).href), note);
  const desktop = path.join(home, 'Desktop', '01 - Modèle Assignation.docx');
  assert.equal(await resolve('~/Desktop/01 - Modèle Assignation.docx'), desktop);
  assert.equal(await resolve(pathToFileURL(desktop).href), desktop);
  assert.equal(await resolve(path.join(outside, 'piece.txt')), path.join(outside, 'piece.txt'));
});

test('un nom seul doit être unique dans le dossier', async () => {
  assert.equal(await resolve('unique.docx'), path.join(project, 'a', 'unique.docx'));
  assert.equal(await resolve('double.md'), null);
  assert.equal(await resolve('inexistant.docx'), null);
  assert.equal(await resolve('cache.md'), null);
  assert.equal(await resolve('01 - Modèle Assignation.docx'), null);
});

test('refuse un lien cassé, un dossier ou un chemin inventé', async () => {
  assert.equal(await resolve('casse.md'), null);
  assert.equal(await resolve('vers-dossier.md'), null);
  assert.equal(await resolve('src'), null);
  assert.equal(await resolve('src/invente.md'), null);
  assert.equal(await resolveFileRef(null, 'src/note.md', home), null);
});

async function serve(router: express.Router, mount = '/') {
  const app = express();
  app.use(express.json());
  app.use(mount, router);
  app.use((_request, response) => { response.status(418).json({ upstream: true }); });
  const server = app.listen(0);
  await new Promise((done) => server.once('listening', done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, close: () => new Promise((done) => server.close(done)) };
}

test('la résolution par lot renvoie un chemin réel ou null', async () => {
  const app = await serve(createFileLinksRouter(() => project));
  try {
    const response = await fetch(`${app.url}/file-links/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: '1', refs: ['src/note.md', 'invente.md'] }),
    });
    assert.deepEqual(await response.json(), { paths: [path.join(project, 'src', 'note.md'), null] });
  } finally {
    await app.close();
  }
});

test('ouvre et enregistre un fichier hors dossier, laisse le reste à file-tree', async () => {
  const app = await serve(createExternalFileRouter(() => project), '/api/file-tree');
  const piece = path.join(outside, 'piece.txt');
  const read = (filePath: string) => fetch(`${app.url}/api/file-tree/projects/1/file?filePath=${encodeURIComponent(filePath)}`);
  const save = (filePath: string) => fetch(`${app.url}/api/file-tree/projects/1/file`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath, content: 'après' }),
  });
  try {
    assert.deepEqual(await (await read(piece)).json(), { content: 'avant', path: piece });
    const content = await fetch(`${app.url}/api/file-tree/projects/1/files/content?path=${encodeURIComponent(piece)}`);
    assert.equal(content.headers.get('content-type')?.startsWith('text/plain'), true);
    assert.equal(await content.text(), 'avant');

    assert.equal((await save(piece)).status, 200);
    assert.equal(await readFile(piece, 'utf8'), 'après');

    assert.equal((await save(path.join(outside, 'nouveau.txt'))).status, 418);
    assert.equal((await read(path.join(project, 'src', 'note.md'))).status, 418);
    assert.equal((await read('src/note.md')).status, 418);
  } finally {
    await app.close();
  }
});

test('server/index.ts monte le routeur hors dossier avant file-tree (exception CloudCLI)', async () => {
  const source = await readFile(path.join(import.meta.dirname, '..', 'index.ts'), 'utf8');
  const external = source.indexOf("app.use('/api/file-tree', authenticateToken, createExternalFileRouter());");
  const upstream = source.indexOf("app.use('/api/file-tree', authenticateToken, fileTreeRoutes);");
  assert.ok(external >= 0 && upstream > external);
});
