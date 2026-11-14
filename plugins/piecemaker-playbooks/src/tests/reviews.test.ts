import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { test } from 'node:test';
import { PlaybookJobs } from '../server/jobs.js';
import { PlaybookStore, hash } from '../server/store.js';
import { createHandler, saveReviewedDocument } from '../server/api.js';
import { readDocument } from '../server/documents.js';
import { PlaybookError } from '../domain/model.js';
import { completed, CONTRACT, docx, REPLACEMENT, reviewOutput, RULE } from './fixtures.js';

const settings = { provider: 'claude' as const, model: 'haiku', proxyOrigin: 'http://127.0.0.1:12345' };

async function fixture(context: { after(callback: () => unknown): void }) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'playbooks-test-'));
  context.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const bytes = await docx();
  fs.writeFileSync(path.join(project, 'contrat.docx'), bytes);
  return { project, bytes, store: new PlaybookStore(project) };
}

test('un guide importé répare ses références puis exige une validation humaine avant toute revue', async (context) => {
  const { store } = await fixture(context);
  let calls = 0;
  const jobs = new PlaybookJobs(async () => {
    calls += 1;
    return JSON.stringify({ name: 'Guide exemple', rules: [{ ...RULE, sourceRefs: [calls === 1 ? 'P999' : 'P1'] }] });
  });
  const importing = await jobs.start(store, 'import', 'contrat.docx', settings, null, 'strict');
  await completed(store, importing.id);
  const imported = store.run(importing.id);
  assert.equal(imported.status, 'completed');
  assert.equal(calls, 2);
  assert.equal(imported.playbook?.validated, false);
  assert.equal(imported.playbook?.sources[0].text, CONTRACT);
  await assert.rejects(jobs.start(store, 'review', 'contrat.docx', settings, imported.playbook, 'strict'), /Validez/);
  const validated = store.save({ ...imported.playbook, validated: true });
  assert.equal(validated.validated, true);
  assert.equal(store.get(validated.id).sourceHash, imported.sourceHash);
});

test('un échec de connexion Claude indique la reconnexion sans exposer les autres erreurs internes', async (context) => {
  for (const [failure, expected] of [
    ['Session claude en erreur : Failed to authenticate: this login reached its time limit and cannot be renewed.', 'La connexion Claude a expiré. Reconnectez votre compte Claude, puis reprenez ce traitement.'],
    ['Détail interne du fournisseur', 'La session IA n’a pas abouti. Vérifiez votre connexion et votre compte, puis reprenez le traitement.'],
  ]) {
    const { store } = await fixture(context);
    const jobs = new PlaybookJobs(async () => { throw new Error(failure); });
    const run = await jobs.start(store, 'import', 'contrat.docx', settings, null, 'strict');
    await completed(store, run.id);
    assert.equal(store.run(run.id).status, 'failed');
    assert.equal(store.run(run.id).error, expected);
  }
});

test('une revue conserve ses règles et ses octets, signale les omissions et refuse les extraits inventés', async (context) => {
  const { store, bytes, project } = await fixture(context);
  const book = store.save({ name: 'Politique exemple', validated: true, rules: [RULE, { ...RULE, id: 'payment', name: 'Paiement' }] });
  const jobs = new PlaybookJobs(async () => JSON.stringify({ summary: 'Revue', findings: [{ ruleId: RULE.id, status: 'acceptable', quote: 'Extrait qui ne figure pas dans le contrat', analysis: 'Affirmation non étayée.' }] }));
  const initial = await jobs.start(store, 'review', 'contrat.docx', settings, book, 'strict');
  store.save({ ...book, name: 'Nouvelle politique', rules: [{ ...RULE, standard: 'Autre position' }] });
  await completed(store, initial.id);
  const run = store.run(initial.id);
  assert.equal(run.playbook?.name, 'Politique exemple');
  assert.equal(run.findings.length, 2);
  assert.ok(run.findings.every((finding) => finding.status === 'needs_review' && !finding.verified));
  assert.deepEqual(fs.readFileSync(path.join(project, 'contrat.docx')), bytes);
  assert.deepEqual(fs.readFileSync(store.runFile(run.id, 'document-revu.docx')), bytes);
  assert.equal(run.outputHash, hash(bytes));
});

test('une sauvegarde Word interrompue est rapprochée et ne permet pas de proposer deux fois la même révision', async (context) => {
  const { store, project, bytes } = await fixture(context);
  const book = store.save({ name: 'Guide', rules: [RULE], validated: true });
  const jobs = new PlaybookJobs(async () => reviewOutput());
  const started = await jobs.start(store, 'review', 'contrat.docx', settings, book, 'strict');
  await completed(store, started.id);
  const run = store.run(started.id);
  const revised = await docx(REPLACEMENT);
  const rename = fs.renameSync;
  const failing = context.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
    if (to === store.runFile(run.id)) throw new Error('Arrêt pendant le reçu de publication');
    return rename(from, to);
  });
  await assert.rejects(saveReviewedDocument(store, run.id, { expectedHash: run.outputHash, buffer: revised.toString('base64'), findingId: run.findings[0].id }), /Arrêt/);
  failing.mock.restore();
  const recovered = new PlaybookStore(project).run(run.id);
  assert.equal(recovered.outputHash, hash(revised));
  assert.equal(recovered.findings[0].applied, true);
  assert.deepEqual(fs.readFileSync(path.join(project, 'contrat.docx')), bytes);
  await assert.rejects(saveReviewedDocument(store, run.id, { expectedHash: recovered.outputHash, buffer: revised.toString('base64'), findingId: run.findings[0].id }), /ne peut pas être appliquée/);
  await assert.rejects(saveReviewedDocument(store, run.id, { expectedHash: run.outputHash, buffer: bytes.toString('base64') }), /a changé/);
});

test('un arrêt enregistre son état et une réponse tardive ne le transforme pas en succès', async (context) => {
  const { store } = await fixture(context);
  const book = store.save({ name: 'Guide', rules: [RULE], validated: true });
  let release!: (value: string) => void;
  const jobs = new PlaybookJobs(async () => new Promise<string>((resolve) => { release = resolve; }));
  const run = await jobs.start(store, 'review', 'contrat.docx', settings, book, 'strict');
  await new Promise((resolve) => setImmediate(resolve));
  jobs.cancel(store, run.id);
  release(reviewOutput());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.run(run.id).status, 'cancelled');
  assert.equal(store.run(run.id).outputHash, null);
  const resumed = new PlaybookJobs(async () => reviewOutput());
  resumed.retry(store, run.id, settings);
  await completed(store, run.id);
  assert.equal(store.run(run.id).status, 'completed');
});

test('le serveur refuse un appel sans secret et un dossier non autorisé ; les liens hors dossier restent illisibles', async (context) => {
  const { store, project } = await fixture(context);
  const jobs = new PlaybookJobs(async () => reviewOutput());
  const secret = 'f'.repeat(64);
  const server = http.createServer(createHandler({ secret, jobs, editorStyle: () => '',
    project: (value) => { if (value !== project) throw new PlaybookError('Dossier non autorisé.', 403); return project; }, protected: () => false }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(`${origin}/catalog?project=${encodeURIComponent(project)}`)).status, 401);
  const headers = { 'x-plugin-secret-access': secret, 'content-type': 'application/json' };
  assert.equal((await fetch(`${origin}/catalog?project=/elsewhere`, { headers })).status, 403);
  const response = await fetch(`${origin}/imports`, { method: 'POST', headers, body: JSON.stringify({ project, sourcePath: 'contrat.docx', ...settings }) });
  assert.equal(response.status, 400);
  assert.equal(store.runs().length, 0);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'playbook-outside-'));
  context.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'confidentiel.txt'), 'Texte fictif externe');
  fs.symlinkSync(outside, path.join(project, 'lien'), 'junction');
  await assert.rejects(readDocument(project, 'lien/confidentiel.txt'), /symboliques/);
  await assert.rejects(readDocument(project, '../confidentiel.txt'), /invalide/);
});

test('une ancienne exécution ne peut pas écraser le résultat après récupération et reprise', async (context) => {
  const { store } = await fixture(context);
  const book = store.save({ name: 'Guide', rules: [RULE], validated: true });
  let release!: (value: string) => void;
  const abandoned = new PlaybookJobs(async () => new Promise<string>((resolve) => { release = resolve; }));
  const run = await abandoned.start(store, 'review', 'contrat.docx', settings, book, 'strict');
  await new Promise((resolve) => setImmediate(resolve));
  const recovered = new PlaybookJobs(async () => reviewOutput());
  recovered.recover(store);
  assert.equal(store.run(run.id).status, 'interrupted');
  recovered.retry(store, run.id, settings);
  await completed(store, run.id);
  const saved = store.run(run.id);
  release(JSON.stringify({ summary: 'Ancienne réponse périmée', findings: [] }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.run(run.id).summary, saved.summary);
  assert.equal(store.run(run.id).findings[0].status, 'unacceptable');
});
