import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertSafeGlinerEntries,
  blobsDirectory,
  extractGlinerArchive,
  glinerAssetName,
  huggingFaceHub,
  isSnapshotComplete,
  packGlinerCache,
  readCheckpoint,
  refsMainPath,
  repoFolder,
  snapshotDirectory,
  writeRefsMain,
} from './gliner-cache.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(root, '../..');

test('le checkpoint épinglé est le snapshot GLiNER2-PII complet', async () => {
  const checkpoint = await readCheckpoint(repoRoot);
  assert.equal(checkpoint.modelId, 'fastino/gliner2-privacy-filter-PII-multi');
  assert.equal(checkpoint.revision, '59894c087cb2923b01f337d4ee72f6ff84d5bdd6');
  assert.equal(checkpoint.revision.length, 40);
  assert.deepEqual(checkpoint.files.map(file => file.path).sort(), [
    'config.json',
    'encoder_config/config.json',
    'model.safetensors',
    'tokenizer.json',
    'tokenizer_config.json',
  ]);
  assert.equal(glinerAssetName(checkpoint.revision), `piecemaker-gliner-${checkpoint.revision}.tar.gz`);
  const sh = fs.readFileSync(path.join(root, '..', 'install.sh'), 'utf8');
  const ps1 = fs.readFileSync(path.join(root, '..', 'install.ps1'), 'utf8');
  const warmup = fs.readFileSync(path.join(repoRoot, 'server/piecemaker/vendor/websocket-server/scripts/warmup.py'), 'utf8');
  const admin = fs.readFileSync(path.join(repoRoot, 'server/piecemaker/vendor/websocket-server/admin-routes.cjs'), 'utf8');
  assert.match(sh, new RegExp(checkpoint.revision));
  assert.match(ps1, new RegExp(checkpoint.revision));
  assert.match(warmup, /revision=PREFERRED_GLINER_REVISION/);
  assert.match(admin, /gliner-checkpoint\.json/);
});

test('refuse les liens symboliques et les chemins hors de l’arbre Hub', () => {
  const folder = 'models--fastino--gliner2-privacy-filter-PII-multi';
  assert.doesNotThrow(() => assertSafeGlinerEntries(
    `${folder}/\n${folder}/refs/main\n${folder}/blobs/abc\n${folder}/snapshots/abc/config.json\n`,
    '-rw-r--r-- file\n',
    folder,
  ));
  assert.doesNotThrow(() => assertSafeGlinerEntries(
    `${folder}/snapshots/abc/config.json\n`,
    `hrw-r--r--  0 user group 0 date ${folder}/snapshots/abc/config.json link to ${folder}/blobs/abc\n`,
    folder,
  ));
  assert.throws(() => assertSafeGlinerEntries(`${folder}/../outside`, '', folder), /invalide/);
  assert.throws(() => assertSafeGlinerEntries('other/file', '', folder), /préfixe/);
  assert.throws(() => assertSafeGlinerEntries(`${folder}/link`, 'lrwxr-xr-x link', folder), /lien/);
  assert.throws(() => assertSafeGlinerEntries(
    `${folder}/snapshots/abc/config.json\n`,
    `hrw-r--r--  0 user group 0 date ${folder}/snapshots/abc/config.json link to /etc/passwd\n`,
    folder,
  ), /préfixe|invalide/);
});

test('extrait l’arbre Hub avec refs/main de 40 octets et vérifie les hash', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-gliner-test-'));
  const hub = path.join(work, 'hub');
  const checkpoint = {
    modelId: 'fastino/gliner2-privacy-filter-PII-multi',
    revision: '59894c087cb2923b01f337d4ee72f6ff84d5bdd6',
    files: [
      { path: 'config.json', sha256: '' },
      { path: 'model.safetensors', sha256: '' },
      { path: 'tokenizer.json', sha256: '' },
      { path: 'tokenizer_config.json', sha256: '' },
      { path: 'encoder_config/config.json', sha256: '' },
    ],
  };
  const packedRoot = path.join(work, 'pack');
  const snap = path.join(packedRoot, repoFolder(checkpoint.modelId), 'snapshots', checkpoint.revision);
  fs.mkdirSync(path.join(snap, 'encoder_config'), { recursive: true });
  for (const file of checkpoint.files) {
    const target = path.join(snap, file.path);
    fs.writeFileSync(target, `payload:${file.path}`);
    file.sha256 = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  }
  fs.mkdirSync(path.join(packedRoot, repoFolder(checkpoint.modelId), 'refs'), { recursive: true });
  fs.writeFileSync(path.join(packedRoot, repoFolder(checkpoint.modelId), 'refs', 'main'), `${checkpoint.revision}\n`);
  const archive = path.join(work, 'gliner.tar.gz');
  const packed = spawnSync('tar', ['-czf', archive, '-C', packedRoot, repoFolder(checkpoint.modelId)], { encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  const host = { async exists(target) { return fs.existsSync(target); } };
  await extractGlinerArchive({ archive, hub, checkpoint });
  assert.equal(await isSnapshotComplete(host, hub, checkpoint), true);
  const refs = fs.readFileSync(refsMainPath(hub, checkpoint));
  assert.equal(refs.length, 40);
  assert.equal(refs.toString('ascii'), checkpoint.revision);
  assert.equal(fs.readFileSync(path.join(snapshotDirectory(hub, checkpoint), 'encoder_config/config.json'), 'utf8'), 'payload:encoder_config/config.json');
  for (const file of checkpoint.files) {
    assert.equal(
      fs.readFileSync(path.join(blobsDirectory(hub, checkpoint), file.sha256), 'utf8'),
      `payload:${file.path}`,
    );
  }
  fs.rmSync(work, { recursive: true, force: true });
});

test('packGlinerCache reprend un cache Hub local et produit une archive extraible', {
  skip: process.platform === 'win32',
}, async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-gliner-pack-'));
  const source = path.join(work, 'src');
  const scripts = path.join(source, 'server/piecemaker/vendor/websocket-server/scripts/presidio-gliner');
  fs.mkdirSync(scripts, { recursive: true });
  const checkpoint = {
    modelId: 'fastino/gliner2-privacy-filter-PII-multi',
    revision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    files: [
      { path: 'config.json', sha256: '' },
      { path: 'model.safetensors', sha256: '' },
      { path: 'tokenizer.json', sha256: '' },
      { path: 'tokenizer_config.json', sha256: '' },
      { path: 'encoder_config/config.json', sha256: '' },
    ],
  };
  const hub = huggingFaceHub({ HF_HUB_CACHE: path.join(work, 'hub') }, work);
  const snap = snapshotDirectory(hub, checkpoint);
  fs.mkdirSync(path.join(snap, 'encoder_config'), { recursive: true });
  for (const file of checkpoint.files) {
    const target = path.join(snap, file.path);
    fs.writeFileSync(target, `local:${file.path}`);
    file.sha256 = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  }
  fs.writeFileSync(path.join(scripts, 'gliner-checkpoint.json'), `${JSON.stringify(checkpoint, null, 2)}\n`);
  const output = path.join(work, 'out');
  const packed = await packGlinerCache({
    sourceDir: source,
    outputDir: output,
    hub,
    fetchImpl: async () => { throw new Error('réseau inattendu'); },
  });
  assert.equal(packed.assetName, glinerAssetName(checkpoint.revision));
  assert.equal(fs.existsSync(packed.archive), true);
  const listing = spawnSync('tar', ['-tvzf', packed.archive], { encoding: 'utf8' });
  assert.equal(listing.status, 0, listing.stderr);
  assert.equal(listing.stdout.split(/\r?\n/).some(line => /^l/.test(line)), false);
  assert.match(listing.stdout, /blobs\//);
  assert.match(listing.stdout, /refs\/main/);
  assert.match(listing.stdout, new RegExp(`snapshots/${checkpoint.revision}/model\\.safetensors`));
  const destHub = path.join(work, 'dest-hub');
  await extractGlinerArchive({ archive: packed.archive, hub: destHub, checkpoint });
  assert.equal(fs.readFileSync(path.join(snapshotDirectory(destHub, checkpoint), 'model.safetensors'), 'utf8'), 'local:model.safetensors');
  assert.equal(
    fs.readFileSync(path.join(blobsDirectory(destHub, checkpoint), checkpoint.files.find(file => file.path === 'model.safetensors').sha256), 'utf8'),
    'local:model.safetensors',
  );
  await writeRefsMain(destHub, checkpoint);
  assert.equal(fs.readFileSync(refsMainPath(destHub, checkpoint)).length, 40);
  assert.equal(fs.readFileSync(refsMainPath(destHub, checkpoint)).toString('ascii'), checkpoint.revision);
  fs.rmSync(work, { recursive: true, force: true });
});

test('packGlinerCache suit un snapshot Hub à liens et n’écrit jamais main', {
  skip: process.platform === 'win32',
}, async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-gliner-symlink-'));
  const source = path.join(work, 'src');
  const scripts = path.join(source, 'server/piecemaker/vendor/websocket-server/scripts/presidio-gliner');
  fs.mkdirSync(scripts, { recursive: true });
  const checkpoint = {
    modelId: 'fastino/gliner2-privacy-filter-PII-multi',
    revision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    files: [
      { path: 'config.json', sha256: '' },
      { path: 'model.safetensors', sha256: '' },
      { path: 'tokenizer.json', sha256: '' },
      { path: 'tokenizer_config.json', sha256: '' },
      { path: 'encoder_config/config.json', sha256: '' },
    ],
  };
  const hub = huggingFaceHub({ HF_HUB_CACHE: path.join(work, 'hub') }, work);
  const blobs = blobsDirectory(hub, checkpoint);
  fs.mkdirSync(path.join(snapshotDirectory(hub, checkpoint), 'encoder_config'), { recursive: true });
  fs.mkdirSync(blobs, { recursive: true });
  for (const file of checkpoint.files) {
    const payload = `blob:${file.path}`;
    file.sha256 = crypto.createHash('sha256').update(payload).digest('hex');
    const blobFile = path.join(blobs, file.sha256);
    const snapshotFile = path.join(snapshotDirectory(hub, checkpoint), file.path);
    fs.writeFileSync(blobFile, payload);
    fs.symlinkSync(path.relative(path.dirname(snapshotFile), blobFile), snapshotFile);
  }
  fs.mkdirSync(path.dirname(refsMainPath(hub, checkpoint)), { recursive: true });
  fs.writeFileSync(refsMainPath(hub, checkpoint), 'cccccccccccccccccccccccccccccccccccccccc');
  fs.writeFileSync(path.join(scripts, 'gliner-checkpoint.json'), `${JSON.stringify(checkpoint, null, 2)}\n`);
  const packed = await packGlinerCache({
    sourceDir: source,
    outputDir: path.join(work, 'out'),
    hub,
    fetchImpl: async () => { throw new Error('réseau inattendu'); },
  });
  const listing = spawnSync('tar', ['-tvzf', packed.archive], { encoding: 'utf8' });
  assert.equal(listing.stdout.split(/\r?\n/).some(line => /^l/.test(line)), false);
  const destHub = path.join(work, 'dest-hub');
  await extractGlinerArchive({ archive: packed.archive, hub: destHub, checkpoint });
  assert.equal(fs.lstatSync(path.join(snapshotDirectory(destHub, checkpoint), 'config.json')).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(refsMainPath(destHub, checkpoint)).toString('ascii'), checkpoint.revision);
  assert.equal(fs.readFileSync(refsMainPath(destHub, checkpoint)).length, 40);
  fs.rmSync(work, { recursive: true, force: true });
});
