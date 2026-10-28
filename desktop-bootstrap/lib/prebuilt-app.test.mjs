import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-prebuilt-mac-'));
  const previous = { assets: process.env.PIECEMAKER_PREBUILT_ASSET_DIR, tag: process.env.PIECEMAKER_TAG, fetch: globalThis.fetch };
  const assets = path.join(root, 'assets');
  const work = path.join(root, 'work');
  const bundle = path.join(root, 'source', 'PieceMaker.app');
  const archive = path.join(assets, `piecemaker-desktop-darwin-${process.arch}.tar.gz`);
  await fs.mkdir(assets, { recursive: true });
  await fs.mkdir(work, { recursive: true });
  process.env.PIECEMAKER_PREBUILT_ASSET_DIR = assets;
  process.env.PIECEMAKER_TAG = 'fixture-prebuilt';
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  t.after(async () => {
    for (const [name, value] of [['PIECEMAKER_PREBUILT_ASSET_DIR', previous.assets], ['PIECEMAKER_TAG', previous.tag]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    globalThis.fetch = previous.fetch;
    await fs.rm(root, { recursive: true, force: true });
  });
  for (const relative of [
    'Contents/MacOS/PieceMaker',
    'Contents/Resources/libreoffice/LibreOffice.app/Contents/MacOS/soffice',
    'Contents/Resources/app/dist-server/server/index.js',
    'Contents/Resources/app/server/piecemaker/vendor/websocket-server/originals-pipeline.cjs',
    'Contents/Resources/app/server/piecemaker/anonymizer/bin/piecemaker-hudsucker',
    'Contents/Frameworks/Fixture.framework/Versions/A/Fixture',
  ]) {
    const file = path.join(bundle, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'fixture', { mode: 0o755 });
  }
  await fs.symlink('A', path.join(bundle, 'Contents/Frameworks/Fixture.framework/Versions/Current'));
  const pack = async (entries = ['PieceMaker.app']) => {
    execFileSync('/usr/bin/tar', ['-czf', archive, '-C', path.dirname(bundle), ...entries]);
    const hash = crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex');
    await fs.writeFile(`${archive}.sha256`, hash);
  };
  await pack();
  const { downloadPrebuiltApp } = await import('./build.mjs');
  return { root, work, bundle, archive, pack, downloadPrebuiltApp };
}

const mac = { skip: process.platform !== 'darwin' };

test('installs a precompiled Mac bundle without building and preserves framework links and executable modes', mac, async (t) => {
  const { work, downloadPrebuiltApp } = await fixture(t);
  const installed = await downloadPrebuiltApp(work);
  assert.equal(path.basename(installed), 'PieceMaker.app');
  assert.equal(await fs.readlink(path.join(installed, 'Contents/Frameworks/Fixture.framework/Versions/Current')), 'A');
  assert.equal((await fs.stat(path.join(installed, 'Contents/MacOS/PieceMaker'))).mode & 0o111, 0o111);
  assert.equal(await fs.readFile(path.join(installed, 'Contents/Resources/app/dist-server/server/index.js'), 'utf8'), 'fixture');
});

test('rejects a modified Mac archive before extracting or replacing the installed app', mac, async (t) => {
  const { root, work, archive, downloadPrebuiltApp } = await fixture(t);
  const current = path.join(root, 'current.app');
  await fs.writeFile(current, 'previous-version');
  await fs.appendFile(archive, 'tampered');
  await assert.rejects(downloadPrebuiltApp(work), /Artefact CI invalide/);
  assert.equal(await fs.readFile(current, 'utf8'), 'previous-version');
  assert.deepEqual(await fs.readdir(work), []);
});

test('rejects files outside the Mac bundle even with a valid archive checksum', mac, async (t) => {
  const { work, bundle, pack, downloadPrebuiltApp } = await fixture(t);
  await fs.writeFile(path.join(path.dirname(bundle), 'outside.txt'), 'outside');
  await pack(['PieceMaker.app', 'outside.txt']);
  await assert.rejects(downloadPrebuiltApp(work), /Chemin hors de l'application/);
  assert.equal(await fs.stat(path.join(work, 'prebuilt', 'fixture-prebuilt', `darwin-${process.arch}`)).then(() => true, () => false), false);
});

test('rejects an incomplete precompiled Mac bundle instead of silently compiling', mac, async (t) => {
  const { work, bundle, pack, downloadPrebuiltApp } = await fixture(t);
  await fs.rm(path.join(bundle, 'Contents/Resources/app/dist-server/server/index.js'));
  await pack();
  await assert.rejects(downloadPrebuiltApp(work), /Application construite incomplète/);
});

test('allows the historical source path when an older release has no precompiled Mac asset', mac, async (t) => {
  const { work, archive, downloadPrebuiltApp } = await fixture(t);
  await fs.rm(archive);
  assert.equal(await downloadPrebuiltApp(work), null);
});

test('rejects a downloaded Mac archive whose release checksum does not match', mac, async (t) => {
  const { work, archive, downloadPrebuiltApp } = await fixture(t);
  const bytes = await fs.readFile(archive);
  await fs.rm(archive);
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes,
    text: async () => String(url).endsWith('.sha256') ? '0'.repeat(64) : '',
  });
  await assert.rejects(downloadPrebuiltApp(work), /Artefact CI invalide/);
  assert.deepEqual(await fs.readdir(work), []);
});

test('the Mac release builds the precompiled Electron bundle before the release dependency completes', async () => {
  const workflow = await fs.readFile(new URL('../../.github/workflows/piecemaker-macos-python.yml', import.meta.url), 'utf8');
  const builder = await fs.readFile(new URL('./build-release.mjs', import.meta.url), 'utf8');
  const shell = await fs.readFile(new URL('../install.sh', import.meta.url), 'utf8');
  assert.match(workflow, /node desktop-bootstrap\/lib\/build-release\.mjs/);
  assert.match(workflow, /piecemaker-desktop-darwin-arm64\.tar\.gz\.sha256/);
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: "false"/);
  assert.ok(workflow.indexOf('name: Build precompiled desktop with Electron') < workflow.indexOf('name: Attach precompiled desktop to release'));
  assert.match(builder, /buildDesktopApp\(sourceDir, \{ windowsInstaller: !IS_MAC \}\)/);
  assert.doesNotMatch(shell, /xcode-select -p/);
});

test('rejects a Mac bundle containing a link to an external executable', mac, async (t) => {
  const { root, work, bundle, pack, downloadPrebuiltApp } = await fixture(t);
  const external = path.join(root, 'external');
  await fs.writeFile(external, 'previous-executable');
  const executable = path.join(bundle, 'Contents/MacOS/PieceMaker');
  await fs.rm(executable);
  await fs.symlink(external, executable);
  await pack();
  await assert.rejects(downloadPrebuiltApp(work), /Lien hors de l'application/);
  assert.equal(await fs.readFile(external, 'utf8'), 'previous-executable');
});

test('Mac tar refuses writes through an archive link outside the extraction directory', mac, async (t) => {
  const { root, work, bundle, archive, downloadPrebuiltApp } = await fixture(t);
  const external = path.join(root, 'external-directory');
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, 'protected.txt'), 'previous-data');
  await fs.symlink(external, path.join(bundle, 'Contents/External'));
  const raw = path.join(root, 'malicious.tar');
  execFileSync('/usr/bin/tar', ['-cf', raw, '-C', path.dirname(bundle), 'PieceMaker.app']);
  const payload = path.join(root, 'payload');
  const relative = 'PieceMaker.app/Contents/External/protected.txt';
  await fs.mkdir(path.dirname(path.join(payload, relative)), { recursive: true });
  await fs.writeFile(path.join(payload, relative), 'malicious-overwrite');
  execFileSync('/usr/bin/tar', ['-rf', raw, '-C', payload, relative]);
  const bytes = gzipSync(await fs.readFile(raw));
  await fs.writeFile(archive, bytes);
  await fs.writeFile(`${archive}.sha256`, crypto.createHash('sha256').update(bytes).digest('hex'));
  await assert.rejects(downloadPrebuiltApp(work), /Application précompilée inutilisable/);
  assert.equal(await fs.readFile(path.join(external, 'protected.txt'), 'utf8'), 'previous-data');
});

test('rejects a published Mac archive without its checksum instead of building locally', mac, async (t) => {
  const { work, archive, downloadPrebuiltApp } = await fixture(t);
  await fs.rm(archive);
  globalThis.fetch = async (url) => ({ ok: !String(url).endsWith('.sha256'), status: String(url).endsWith('.sha256') ? 404 : 200 });
  await assert.rejects(downloadPrebuiltApp(work), /empreinte absente/);
  assert.deepEqual(await fs.readdir(work), []);
});
