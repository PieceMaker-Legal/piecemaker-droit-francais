import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { embedLibreOffice, libreOfficePackage, LIBREOFFICE, LIBREOFFICE_MAC, LIBREOFFICE_DIR } from '../steps/10-libreoffice.mjs';

async function stage(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-libreoffice-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ build: { extraResources: [{ from: 'mingit', to: 'mingit' }] } }));
  return directory;
}

test('rejects a modified LibreOffice MSI before extraction', async t => {
  const directory = await stage(t);
  let extracted = false;
  await assert.rejects(embedLibreOffice(directory, {
    platform: 'win32', arch: 'x64',
    fetchImpl: async () => new Response('not the official MSI'),
    extract: async () => { extracted = true; },
  }), /SHA-256/);
  assert.equal(extracted, false);
  await assert.rejects(fs.access(path.join(directory, LIBREOFFICE_DIR)));
});

test('packages the complete extracted runtime with notices and without a second MSI', async t => {
  const directory = await stage(t);
  const bytes = Buffer.from('fictitious MSI');
  const previous = LIBREOFFICE.sha256;
  LIBREOFFICE.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  t.after(() => { LIBREOFFICE.sha256 = previous; });
  const options = {
    platform: 'win32', arch: 'x64',
    fetchImpl: async () => new Response(bytes),
    extract: async (_archive, destination) => {
      await fs.mkdir(path.join(destination, 'program'), { recursive: true });
      for (const file of ['soffice.com', 'soffice.exe', 'soffice.bin']) await fs.writeFile(path.join(destination, 'program', file), 'fixture');
      await fs.writeFile(path.join(destination, 'LICENSE.html'), 'fictitious license fixture');
      await fs.writeFile(path.join(destination, 'libreoffice.msi'), bytes);
    },
  };
  await embedLibreOffice(directory, options);
  await embedLibreOffice(directory, options);
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.build.extraResources, [{ from: 'mingit', to: 'mingit' }, { from: LIBREOFFICE_DIR, to: LIBREOFFICE_DIR }]);
  await fs.access(path.join(directory, LIBREOFFICE_DIR, 'program', 'soffice.com'));
  await fs.access(path.join(directory, LIBREOFFICE_DIR, 'LICENSE.html'));
  assert.match(await fs.readFile(path.join(directory, LIBREOFFICE_DIR, 'PIECEMAKER-SOURCES.txt'), 'utf8'), /libreoffice\/src\/26\.8\.1/);
  await assert.rejects(fs.access(path.join(directory, 'libreoffice.msi')));
  await assert.rejects(fs.access(path.join(directory, LIBREOFFICE_DIR, 'libreoffice.msi')));
});

test('selects native LibreOffice packages and rejects unsupported architectures', () => {
  assert.equal(libreOfficePackage('win32', 'x64'), LIBREOFFICE);
  assert.equal(libreOfficePackage('darwin', 'arm64'), LIBREOFFICE_MAC.arm64);
  assert.equal(libreOfficePackage('darwin', 'x64'), LIBREOFFICE_MAC.x64);
  assert.notEqual(LIBREOFFICE_MAC.arm64.sha256, LIBREOFFICE_MAC.x64.sha256);
  assert.throws(() => libreOfficePackage('darwin', 'ia32'), /non disponible/);
});

for (const arch of ['arm64', 'x64']) {
  test(`packages the complete macOS ${arch} app and retains its executable mode`, async t => {
    const directory = await stage(t);
    const bytes = Buffer.from(`fictitious ${arch} DMG`);
    const metadata = LIBREOFFICE_MAC[arch];
    const previous = metadata.sha256;
    metadata.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    t.after(() => { metadata.sha256 = previous; });
    await embedLibreOffice(directory, {
      platform: 'darwin', arch,
      fetchImpl: async url => { assert.equal(url, metadata.url); return new Response(bytes); },
      extract: async (_archive, destination, platform) => {
        assert.equal(platform, 'darwin');
        const app = path.join(destination, 'LibreOffice.app', 'Contents');
        await fs.mkdir(path.join(app, 'MacOS'), { recursive: true });
        await fs.mkdir(path.join(app, 'Resources'));
        await fs.writeFile(path.join(app, 'MacOS', 'soffice'), 'fixture', { mode: 0o755 });
        await fs.writeFile(path.join(app, 'Resources', 'LICENSE.html'), 'fictitious license fixture');
      },
    });
    const binary = path.join(directory, LIBREOFFICE_DIR, 'LibreOffice.app', 'Contents', 'MacOS', 'soffice');
    await fs.access(binary);
    if (process.platform !== 'win32') assert.equal((await fs.stat(binary)).mode & 0o111, 0o111);
    await assert.rejects(fs.access(path.join(directory, 'libreoffice.dmg')));
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    assert.equal(manifest.build.extraResources.filter(entry => entry.to === LIBREOFFICE_DIR).length, 1);
  });
}
