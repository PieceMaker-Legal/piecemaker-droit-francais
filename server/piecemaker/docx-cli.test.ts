import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DocxDocumentConflictError, readDocxReview, readDocxSnapshot, runDirectDocxReview, runDocxReview } from '@/modules/piecemaker-docx/index.js';
import { runDocxCli } from '@/piecemaker/docx-cli.js';
import { installDocxCommand } from '@/piecemaker/docx-command.js';

const binary = execFileSync('/bin/sh', ['-c', 'command -v docx'], { encoding: 'utf8' }).trim();

async function fixture(context: { after(fn: () => Promise<unknown>): void }) {
  const project = await mkdtemp(path.join(os.homedir(), '.docx-cli-review-test-'));
  context.after(() => rm(project, { recursive: true, force: true }));
  const file = path.join(project, 'contrat.docx');
  execFileSync(binary, ['create', file, '--text', 'Paiement sous 90 jours. Plafond de 100 euros.']);
  return { project, file, source: await readFile(file) };
}

test('une édition réelle docx-cli produit les cartes avec motifs, conserve la source et permet les décisions Mike', async (context) => {
  const { project, file, source } = await fixture(context);
  const batch = [
    { pattern: '90', replacement: '30', reason: 'Réduire le délai.' },
    { pattern: '100', replacement: '500', reason: 'Relever le plafond.' },
  ].map((entry) => JSON.stringify(entry)).join('\n');
  const runtime = path.join(project, 'runtime');
  const env = { ...process.env, PIECEMAKER_HOME: runtime };
  installDocxCommand(runtime, process.cwd(), env);
  await writeFile(path.join(runtime, 'projects.json'), JSON.stringify({ sources: { test: [project] } }));
  execFileSync('docx', ['replace', file, '--batch', '-', '--track', '--author', 'Codex'], { env, input: batch });
  const review = await readDocxReview(project, file);
  assert.equal(review.versions.length, 2);
  assert.deepEqual(await readDocxSnapshot(project, file, review.versions[0].id), source);
  assert.deepEqual(review.annotations.map((entry) => [entry.deleted_text, entry.inserted_text, entry.reason]), [
    ['90', '30', 'Réduire le délai.'], ['100', '500', 'Relever le plafond.'],
  ]);
  await runDocxReview(project, file, { action: 'reject', edit_id: review.annotations[0].edit_id, expected_sha256: review.sha256 });
  await runDocxReview(project, file, { action: 'accept', edit_id: review.annotations[1].edit_id });
  const text = execFileSync(binary, ['read', file], { encoding: 'utf8' });
  assert.match(text, /Paiement sous 90 jours\. Plafond de 500 euros\./);
  assert.deepEqual(JSON.parse(execFileSync(binary, ['track-changes', 'list', file, '--json'], { encoding: 'utf8' })), []);
  assert.deepEqual((await readDocxReview(project, file)).annotations.map((entry) => entry.status), ['rejected', 'accepted']);
});

test('un lot partiellement en erreur publie seulement les révisions effectivement produites', async (context) => {
  const { project, file } = await fixture(context);
  const batch = path.join(project, 'substitutions.jsonl');
  await writeFile(batch, [
    { pattern: '90', replacement: '45', reason: 'Ajuster le délai.' },
    { pattern: 'ABSENT', replacement: 'autre' },
  ].map((entry) => JSON.stringify(entry)).join('\n'));
  const result = await runDocxCli(['replace', file, '--batch', batch, '--track'], binary, project);
  assert.equal(result.code, 3);
  const review = await readDocxReview(project, file);
  assert.equal(review.annotations.length, 1);
  assert.equal(review.annotations[0].reason, 'Ajuster le délai.');
  assert.match(execFileSync(binary, ['read', file], { encoding: 'utf8' }), /45 jours/);
});

test('les révisions préexistantes ne deviennent pas des cartes de la nouvelle commande et une lecture ne crée pas de version', async (context) => {
  const { project, file } = await fixture(context);
  execFileSync(binary, ['replace', file, '100', '200', '--track', '--author', 'Avocat']);
  await runDocxCli(['replace', file, '90', '30', '--track', '--author', 'Codex'], binary, project);
  const review = await readDocxReview(project, file);
  assert.equal(review.annotations.length, 1);
  assert.equal(review.annotations[0].deleted_text, '90');
  await runDocxReview(project, file, { action: 'reject', edit_id: review.annotations[0].edit_id });
  const revisions = JSON.parse(execFileSync(binary, ['track-changes', 'list', file, '--json'], { encoding: 'utf8' }));
  assert.deepEqual(revisions.map((entry: { author: string }) => entry.author), ['Avocat', 'Avocat']);
  const env = { ...process.env };
  installDocxCommand(path.join(project, 'runtime'), process.cwd(), env);
  assert.match(execFileSync('docx', ['--version'], { env, encoding: 'utf8' }), /^docx /);
  assert.equal((await readDocxReview(project, file)).versions.length, 2);
});

test('une écriture concurrente est conservée et empêche la publication du fichier préparé', async (context) => {
  const { project, file } = await fixture(context);
  await assert.rejects(runDirectDocxReview(project, file, {
    inventory: async () => [], reasons: [],
    mutate: async (staging) => {
      execFileSync(binary, ['replace', staging, '90', '30', '--track']);
      execFileSync(binary, ['replace', file, '100', '800']);
    },
  }), DocxDocumentConflictError);
  const text = execFileSync(binary, ['read', file], { encoding: 'utf8' });
  assert.match(text, /90 jours\. Plafond de 800 euros/);
  assert.equal((await readDocxReview(project, file)).versions.length, 0);
});
