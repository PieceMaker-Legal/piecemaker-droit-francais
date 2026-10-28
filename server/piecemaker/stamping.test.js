import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const express = require('express');
const { PDFDocument, PDFName, decodePDFRawStream } = require('pdf-lib');
const { createStampingRouter } = require('./vendor/websocket-server/stamping-routes.cjs');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ioAAAAASUVORK5CYII=', 'base64');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

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
  const hashes = pieces.map(file => hash(path.join(folder, file)));
  const stamped = await request('/stamping', { documentId: 'dossier-exemple', folder, pieces });
  assert.equal(stamped.status, 200);
  assert.deepEqual(stamped.body.summary, { total: 3, success: 3, failure: 0 });
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
