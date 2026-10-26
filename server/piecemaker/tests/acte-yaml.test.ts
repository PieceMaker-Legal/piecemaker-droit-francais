import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';
import JSZip from 'jszip';

import { createReasoningService, parseReasoningDocument, printReasoningDocument } from '../../modules/piecemaker-reasoning/index.js';
import type { ReasoningConnectors } from '../../modules/piecemaker-reasoning/index.js';
import { runActeAction } from '../acte-files.js';
import { readActeDocx } from '../acte-docx.js';

const connectors: ReasoningConnectors = {
  source: async () => ({ kind: 'texte', title: 'Règle fictive', text: 'Un fait établit un effet.' }),
  match: (text, excerpt) => text.includes(excerpt) ? excerpt : null,
  registry: async () => ({ found: true, status: 'active' }),
  bodacc: async () => [],
};

test('le service natif choisit YAML, le persiste et conserve les retouches Word', async (t) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'pm-yaml-')));
  const db = new Database(':memory:');
  t.after(async () => { db.close(); await rm(root, { recursive: true, force: true }); });
  db.exec('CREATE TABLE projects(project_id TEXT PRIMARY KEY, project_path TEXT);');
  db.prepare('INSERT INTO projects VALUES(?,?)').run('fictif', root);
  await mkdir(path.join(root, '.piecemaker'));
  const file = path.join(root, '.piecemaker/raisonnement.yaml');
  const value: Record<string, unknown> = { objectifs: [{ objectif: 'Obtenir un effet fictif', obtenir: 'effet' }], effet: { si: [{ fait: true, selon: [{ source: 'LEGIARTI000000000001', citation: 'Un fait établit un effet.' }] }] } };
  value.acte = [{ intitule: 'Discussion fictive', texte: ['Une première rédaction.'] }];
  await writeFile(file, printReasoningDocument(value, 'yaml'));
  const service = createReasoningService(() => db, connectors);
  const verify = (cwd: string) => service.verify(cwd);
  const first = await verify(root);
  assert.ok(first.code.startsWith('objectifs:'));
  assert.equal(service.read(root).code, first.code);
  const output = path.join(root, 'acte.docx');
  await runActeAction({ commande: 'exporter', cwd: root, sortie: 'acte.docx' }, verify);
  const zip = await JSZip.loadAsync(await readFile(output));
  zip.file('word/document.xml', (await zip.file('word/document.xml')!.async('string')).replace('Une première rédaction.', 'Une rédaction précisée.'));
  await writeFile(output, await zip.generateAsync({ type: 'uint8array' }));
  await runActeAction({ commande: 'fusionner', cwd: root, fichier: 'acte.docx' }, verify);
  const updated = parseReasoningDocument(await readFile(file, 'utf8'), 'yaml').value as typeof value;
  assert.deepEqual(updated.acte, [{ id: 's1', intitule: 'Discussion fictive', texte: ['Une rédaction précisée.'] }]);
  await runActeAction({ commande: 'exporter', cwd: root, sortie: 'acte.docx' }, verify);
  assert.equal((await readActeDocx(await readFile(output), 'fusion')).sections[0].texte[0], 'Une rédaction précisée.');
  delete updated.acte;
  await writeFile(file, printReasoningDocument(updated, 'yaml'));
  const external = await JSZip.loadAsync(await readFile(output));
  external.remove('docProps/custom.xml');
  await writeFile(path.join(root, 'externe.docx'), await external.generateAsync({ type: 'uint8array' }));
  await runActeAction({ commande: 'importer', cwd: root, fichier: 'externe.docx' }, verify);
  const imported = parseReasoningDocument(await readFile(file, 'utf8'), 'yaml').value as Record<string, unknown>;
  assert.ok(Array.isArray(imported.acte));
  assert.deepEqual(imported.objectifs, value.objectifs);
  await assert.rejects(readFile(path.join(root, '.piecemaker/raisonnement.js')), { code: 'ENOENT' });
});
