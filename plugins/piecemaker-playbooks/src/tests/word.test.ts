import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import JSZip from 'jszip';
import { createHandler } from '../server/api.js';
import { PlaybookStore } from '../server/store.js';
import { PlaybookJobs } from '../server/jobs.js';
import { readDocx } from '../server/documents.js';
import { completed, CONTRACT, docx, REPLACEMENT, reviewOutput, RULE } from './fixtures.js';

test('Eigenpal applique une proposition dans la copie Word, conserve une vraie révision et rouvre le résultat enregistré', { timeout: 90000 }, async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'playbook-eigenpal-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const project = path.join(directory, 'dossier'); fs.mkdirSync(project);
  const original = await docx(); fs.writeFileSync(path.join(project, 'contrat.docx'), original);
  const store = new PlaybookStore(project);
  const book = store.save({ name: 'Guide exemple', validated: true, rules: [RULE] });
  const jobs = new PlaybookJobs(async () => reviewOutput());
  const run = await jobs.start(store, 'review', 'contrat.docx', { provider: 'claude', model: 'haiku', proxyOrigin: 'http://127.0.0.1:12345' }, book, 'strict');
  await completed(store, run.id);
  const bundle = path.join(directory, 'plugin.js');
  await build({ entryPoints: [new URL('../client/index.tsx', import.meta.url).pathname], outfile: bundle,
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent' });
  const require = createRequire(import.meta.url);
  const secret = 'f'.repeat(64);
  const handler = createHandler({ secret, jobs, project: () => project, protected: () => true,
    editorStyle: () => fs.readFileSync(require.resolve('@eigenpal/docx-editor-react/styles.css'), 'utf8') });
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/rpc/')) {
      request.url = request.url!.slice(4); request.headers['x-plugin-secret-access'] = secret;
      void handler(request, response); return;
    }
    if (url.pathname === '/plugin.js') { response.setHeader('content-type', 'application/javascript'); response.end(fs.readFileSync(bundle)); return; }
    if (url.pathname.startsWith('/api/providers/')) { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ data: { models: { OPTIONS: [{ value: 'haiku', label: 'Haiku' }] } } })); return; }
    response.setHeader('content-type', 'text/html');
    response.end(`<html><body style="margin:0"><div id="app" style="height:100vh"></div><script type="module">
      import {mount} from '/plugin.js';
      const project=${JSON.stringify({ name: 'Dossier fictif', path: project })};
      mount(document.getElementById('app'), {context:{theme:'light',project,session:null},onContextChange:()=>()=>{},rpc:async(method,path,body)=>{
        const response=await fetch('/rpc'+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
        return response.json();
      }});
    </script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const browser = await chromium.launch({ headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1450, height: 1000 } });
  await page.route('https://**', (route) => route.abort());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await page.goto(origin);
  await page.getByRole('button', { name: /Revue · contrat.docx/ }).click();
  await page.locator('.docx-editor').getByText(CONTRACT, { exact: true }).first().waitFor({ timeout: 15000 }).catch(async (error) => {
    throw new Error(`${error.message}\n${JSON.stringify(errors)}\n${(await page.locator('body').innerText()).slice(-5000)}`);
  });
  const propose = page.getByRole('button', { name: 'Proposer dans Word : Responsabilité', exact: true });
  assert.equal(await propose.isEnabled(), true, JSON.stringify(await page.locator('[role="alert"]').allTextContents()));
  const saved = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/edits'));
  await propose.click();
  assert.equal((await saved).status(), 200);
  await page.getByRole('button', { name: 'Proposée dans Word : Responsabilité', exact: true }).waitFor();
  const bytes = fs.readFileSync(store.runFile(run.id, 'document-revu.docx'));
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
  assert.match(xml, /<w:ins\b/);
  assert.match(xml, /<w:del\b/);
  assert.equal((await readDocx(bytes)).map((source) => source.text).join('\n'), REPLACEMENT);
  assert.deepEqual(fs.readFileSync(path.join(project, 'contrat.docx')), original);
  assert.equal(store.run(run.id).findings[0].applied, true);
  await page.reload();
  await page.getByRole('button', { name: /Revue · contrat.docx/ }).click();
  await page.locator('.docx-editor').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Proposée dans Word : Responsabilité', exact: true }).isDisabled(), true);
  await page.getByText('La clause ne respecte pas le plafond choisi.', { exact: true }).last().waitFor();
  const rejected = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/edits'));
  await page.getByRole('button', { name: 'Refuser', exact: true }).click();
  assert.equal((await rejected).status(), 200);
  await page.getByRole('button', { name: 'Refusée', exact: true }).waitFor();
  assert.equal((await readDocx(fs.readFileSync(store.runFile(run.id, 'document-revu.docx')))).map((source) => source.text).join('\n'), CONTRACT);
  const finalZip = await JSZip.loadAsync(fs.readFileSync(store.runFile(run.id, 'document-revu.docx')));
  assert.doesNotMatch(await finalZip.file('word/document.xml')!.async('string'), /<w:(ins|del)\b/);
  assert.equal(finalZip.file('word/comments.xml'), null);
  assert.deepEqual(errors, []);
});
