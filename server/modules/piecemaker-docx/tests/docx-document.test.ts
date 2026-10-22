import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import JSZip from 'jszip';

import { saveDocxDocument } from '@/modules/piecemaker-docx/index.js';

for (const malformed of [true, false]) {
  test(`Word save ${malformed ? 'repairs complex-script font themes' : 'preserves a valid archive byte for byte'}`, async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pm-docx-save-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const archive = new JSZip();
    const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:rFonts w:${malformed ? 'csTheme' : 'cstheme'}="minorBidi"/><w:t>csTheme=exemple</w:t></w:document>`;
    archive.file('word/document.xml', xml);
    archive.file('word/styles.xml', xml);
    const image = Buffer.from([0, 1, 128, 255]);
    archive.file('word/media/image.png', image);
    const buffer = await archive.generateAsync({ type: 'nodebuffer' });
    const file = path.join(directory, 'sample.docx');
    assert.ok(await saveDocxDocument(file, buffer) > 0);
    const saved = await readFile(file);
    if (!malformed) assert.deepEqual(saved, buffer);
    const result = await JSZip.loadAsync(saved);
    for (const part of ['word/document.xml', 'word/styles.xml']) {
      assert.equal(await result.file(part)!.async('string'), xml.replace('w:csTheme=', 'w:cstheme='));
    }
    assert.deepEqual(await result.file('word/media/image.png')!.async('nodebuffer'), image);
    assert.deepEqual(await readdir(directory), ['sample.docx']);
  });
}

test('invalid Word payload leaves the existing document intact', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pm-docx-save-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'sample.docx');
  await writeFile(file, 'original');
  await assert.rejects(saveDocxDocument(file, Buffer.from('invalid zip')));
  assert.equal(await readFile(file, 'utf8'), 'original');
  assert.deepEqual(await readdir(directory), ['sample.docx']);
});
