import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const applicationRoot = process.env.PIECEMAKER_STAMP_APP_ROOT;
const require = createRequire(applicationRoot ? path.join(applicationRoot, 'package.json') : import.meta.url);
const express = require('express');
const { PDFDocument, PDFName, decodePDFRawStream } = require('pdf-lib');
const { createStampingRouter } = require(applicationRoot ? path.join(applicationRoot, 'server/piecemaker/vendor/websocket-server/stamping-routes.cjs') : './vendor/websocket-server/stamping-routes.cjs');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ioAAAAASUVORK5CYII=', 'base64');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function officeFixtures(folder) {
  const JSZip = require('jszip');
  const word = new JSZip();
  word.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  word.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  word.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Document fictif ZETABIO</w:t></w:r></w:p></w:body></w:document>');
  const excel = new JSZip();
  excel.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  excel.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  excel.file('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Exemple" sheetId="1" r:id="rId1"/></sheets></workbook>');
  excel.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  excel.file('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>ZETABIO</t></is></c></row></sheetData></worksheet>');
  fs.writeFileSync(path.join(folder, 'preuve.docx'), await word.generateAsync({ type: 'nodebuffer' }));
  fs.writeFileSync(path.join(folder, 'tableau.xlsx'), await excel.generateAsync({ type: 'nodebuffer' }));
  return ['preuve.docx', 'tableau.xlsx'];
}

test('stamp routes save a stamp, create numbered PDFs and retain the original documents', async t => {
  const root = fs.mkdtempSync(path.join(process.cwd(), '.stamp-test-'));
  const home = path.join(root, 'components');
  const folder = path.join(root, 'Dossier Exemple');
  const previousHome = process.env.PIECEMAKER_HOME;
  const previousPort = process.env.PIECEMAKER_APP_PORT;
  fs.mkdirSync(home);
  fs.mkdirSync(folder);
  process.env.PIECEMAKER_HOME = home;
  fs.writeFileSync(path.join(home, 'projects.json'), JSON.stringify({ sources: { test: [folder] } }));
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/piecemaker', createStampingRouter({ homeDir: home }));
  const server = http.createServer(app);
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    if (previousHome === undefined) delete process.env.PIECEMAKER_HOME;
    else process.env.PIECEMAKER_HOME = previousHome;
    if (previousPort === undefined) delete process.env.PIECEMAKER_APP_PORT;
    else process.env.PIECEMAKER_APP_PORT = previousPort;
    fs.rmSync(root, { recursive: true, force: true });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.PIECEMAKER_APP_PORT = String(server.address().port);
  const base = `http://127.0.0.1:${server.address().port}/api/piecemaker`;
  const request = async (route, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(base + route, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await request('/tampon/load')).status, 404);
  assert.equal((await request('/tampon/save', { tamponImage: 'data:image/png;base64,aW52YWxpZA==' })).status, 400);
  const image = `data:image/png;base64,${png.toString('base64')}`;
  assert.equal((await request('/tampon/save', { tamponImage: image })).status, 200);
  assert.equal((await request('/tampon/load')).body.tamponImage, image);

  const original = await PDFDocument.create();
  original.addPage([595, 842]).drawText('Document fictif ZETABIO');
  original.addPage([595, 842]).drawText('Seconde page fictive');
  fs.writeFileSync(path.join(folder, 'preuve.pdf'), await original.save());
  fs.writeFileSync(path.join(folder, 'note.md'), 'Document fictif : ZETABIO.');
  fs.writeFileSync(path.join(folder, 'image.png'), png);
  const pieces = ['preuve.pdf', 'note.md', 'image.png'];
  if (process.env.PIECEMAKER_STAMP_OFFICE === '1') pieces.push(...await officeFixtures(folder));
  const hashes = pieces.map(file => hash(path.join(folder, file)));
  const stamped = await request('/stamping', { documentId: 'dossier-exemple', folder, pieces });
  assert.equal(stamped.status, 200);
  assert.deepEqual(stamped.body.summary, { total: pieces.length, success: pieces.length, failure: 0 });
  assert.deepEqual(stamped.body.results.map(item => item.id), pieces);
  for (let index = 0; index < pieces.length; index++) {
    const output = path.join(folder, 'Pièces tamponnées', `Pièce n°${index + 1}.pdf`);
    const pdf = await PDFDocument.load(fs.readFileSync(output));
    assert.equal(pdf.getPageCount(), index === 0 ? 2 : 1);
    const page = pdf.getPages()[0];
    assert.ok(page.node.Resources().has(PDFName.of('XObject')));
    const contents = page.node.Contents().asArray().map(ref => decodePDFRawStream(pdf.context.lookup(ref)).decode());
    const text = contents.map(bytes => Buffer.from(bytes).toString('latin1')).join('\n');
    assert.match(text, new RegExp(`<${Buffer.from(String(index + 1)).toString('hex')}> Tj`));
    assert.equal(hash(path.join(folder, pieces[index])), hashes[index]);
  }
  const last = await request(`/stamping/last?documentId=dossier-exemple&folder=${encodeURIComponent(folder)}`);
  assert.equal(last.status, 200);
  assert.deepEqual(last.body.results, stamped.body.results);
  const rejected = await request('/stamping', { documentId: 'dossier-exemple', folder, pieces: ['../absent.pdf'] });
  assert.equal(rejected.body.summary.failure, 1);
  assert.equal(rejected.body.results[0].success, false);
  assert.equal((await request('/tampon/delete', undefined, 'DELETE')).status, 200);
  assert.equal((await request('/tampon/load')).status, 404);
});
