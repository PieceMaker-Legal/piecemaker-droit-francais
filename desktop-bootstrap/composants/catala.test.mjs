import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { archivePack, catalaLayout, catalaRecipe, catalaTools, installCatalaPack, unsafeArchiveEntries } from './catala.mjs';

async function fixture(t, change = () => {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'catala-archive-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stage = path.join(root, 'stage');
  const manifest = { format: 1, platform: 'macos', catala: catalaRecipe.catala, tools: Object.fromEntries([...catalaTools, 'ninja'].map((name) => [name, `bin/${name}`])), runtimePython: 'lib/catala/runtime/python/src', topiaryConfig: 'share/topiary/configs/catala.ncl', grammars: [{ language: 'catala_fr', extensions: ['catala_fr'], file: 'share/topiary/grammars/catala_fr.dylib' }] };
  change(manifest);
  for (const name of [...catalaTools, 'ninja']) {
    const file = path.join(stage, 'bin', name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.3.0; fi\n');
    await fs.chmod(file, 0o755);
  }
  const runtime = path.join(stage, manifest.runtimePython, 'catala');
  await fs.mkdir(runtime, { recursive: true });
  await fs.writeFile(path.join(runtime, 'catala_runtime.py'), '');
  await fs.writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest));
  const archive = path.join(root, 'pack.tar.gz');
  const tar = spawnSync('tar', ['-czf', archive, '-C', stage, 'manifest.json', 'bin', 'lib'], { encoding: 'utf8' });
  assert.equal(tar.status, 0, tar.stderr);
  const sha256 = crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex');
  const env = { PIECEMAKER_COMPONENTS_HOME: path.join(root, 'Profil é'), PIECEMAKER_CATALA_ARCHIVE: archive, PIECEMAKER_CATALA_ARCHIVE_SHA256: sha256, PATH: '/usr/bin:/bin' };
  return { root, archive, env, manifest };
}

const native = { skip: process.platform === 'win32' };

test('an archive installs in an accented path, configures local grammars and is reused', native, async (t) => {
  const { env, archive } = await fixture(t);
  const options = { env, platform: 'darwin', arch: 'arm64' };
  const first = await installCatalaPack(options);
  assert.equal(first.state, 'pret', first.error);
  assert.equal(first.pack.proof, true);
  assert.equal(first.pack.env.CATALA_STDLIB, path.join(first.pack.prefix, 'lib', 'catala', 'runtime'));
  assert.match(await fs.readFile(path.join(first.pack.prefix, 'share/topiary/configs/catala.ncl'), 'utf8'), /grammar.source.path/);
  await fs.unlink(archive);
  const again = await installCatalaPack(options);
  assert.equal(again.state, 'pret');
  assert.equal(again.id, first.id);
});

test('a corrupted update preserves the last working descriptor and foreign directories', native, async (t) => {
  const { env, archive } = await fixture(t);
  const first = await installCatalaPack({ env, platform: 'darwin', arch: 'arm64' });
  const foreign = path.join(catalaLayout(env).base, 'autre', 'document');
  await fs.mkdir(path.dirname(foreign), { recursive: true });
  await fs.writeFile(foreign, 'conserver');
  await fs.appendFile(archive, 'corruption');
  const updateEnv = { ...env, PIECEMAKER_CATALA_ARCHIVE_SHA256: 'f'.repeat(64) };
  const failed = await installCatalaPack({ env: updateEnv, platform: 'darwin', arch: 'arm64' });
  assert.equal(failed.state, 'echec');
  assert.match(failed.error, /Empreinte inattendue/);
  assert.equal(JSON.parse(await fs.readFile(catalaLayout(env).packFile, 'utf8')).id, first.id);
  assert.equal(await fs.readFile(foreign, 'utf8'), 'conserver');
});

test('a manifest cannot write its grammar config outside the extracted directory', native, async (t) => {
  const { env, root } = await fixture(t, (manifest) => { manifest.topiaryConfig = '../../outside'; });
  const result = await installCatalaPack({ env, platform: 'darwin', arch: 'arm64' });
  assert.equal(result.state, 'echec');
  assert.match(result.error, /Chemin non sûr/);
  await assert.rejects(fs.access(path.join(root, 'outside')));
});

test('tar traversal, Windows drive paths, links and special files are rejected', () => {
  for (const name of ['../f', '/tmp/f', 'C:/f', 'bin/../f', 'bin\\f']) assert.equal(unsafeArchiveEntries([name], '').length, 1);
  for (const verbose of ['lrwxrwxrwx link -> /tmp', 'hrw-r--r-- link', 'crw-r--r-- device']) assert.equal(unsafeArchiveEntries(['bin/f'], verbose).length, 1);
  assert.deepEqual(unsafeArchiveEntries(['bin/', 'bin/catala'], 'drwxr-xr-x bin\n-rwxr-xr-x bin/catala\n'), []);
});

test('Windows descriptors use native executables and include the same proof and stdlib', () => {
  const manifest = { format: 1, platform: 'windows', tools: Object.fromEntries([...catalaTools, 'ninja'].map((name) => [name, `bin/${name}.exe`])), runtimePython: 'lib/catala/runtime/python/src', topiaryConfig: 'share/topiary/configs/catala.ncl', grammars: [{ language: 'catala_fr', extensions: ['catala_fr'], file: 'share/topiary/grammars/catala_fr.dll' }] };
  const pack = archivePack('C:\\Program Files\\Catala é', 'windows', manifest);
  assert.equal(pack.bin.catala, 'C:\\Program Files\\Catala é\\bin\\catala.exe');
  assert.equal(pack.proof, true);
  assert.equal(pack.env.CATALA_STDLIB, 'C:\\Program Files\\Catala é\\lib\\catala\\runtime');
});

test('an unpinned recipe cannot trigger compilation or download', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'catala-recette-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await installCatalaPack({ env: { PIECEMAKER_COMPONENTS_HOME: root }, platform: 'darwin', arch: 'arm64', recipe: { ...catalaRecipe, archive: {} } });
  assert.equal(result.state, 'indisponible');
  assert.match(result.error, /Aucune archive/);
});
