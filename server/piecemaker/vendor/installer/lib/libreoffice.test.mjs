import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { embedLibreOffice, LIBREOFFICE, LIBREOFFICE_DIR } from '../steps/10-libreoffice.mjs';

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
