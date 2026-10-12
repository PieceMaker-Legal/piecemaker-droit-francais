import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const { createDecisionTextResolver } = createRequire(import.meta.url)('../vendor/piecemaker-plugin/scripts/lib/citation-sources.cjs') as {
  createDecisionTextResolver(roots: string[]): (decisionId: string) => Promise<string>;
};

const DECISION_TEXT = '# Cour de cassation, 1 janvier 2020\n\nMotifs\n\nAttendu que la société Exemple SAS ne justifie pas du versement allégué ;';

function caseFolder(reviews: Record<string, unknown>, documents: Record<string, string>) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-citation-sources-'));
  const reviewDir = path.join(folder, 'Tabular Review');
  fs.mkdirSync(path.join(reviewDir, 'docs'), { recursive: true });
  for (const [name, review] of Object.entries(reviews)) fs.writeFileSync(path.join(reviewDir, name), JSON.stringify(review));
  for (const [copy, content] of Object.entries(documents)) fs.writeFileSync(path.join(reviewDir, ...copy.split('/')), content);
  return folder;
}

function researchRow(decision: string, copy: string, aliases?: string[]) {
  return { id: decision, label: decision, decision, ...(aliases ? { aliases } : {}), documents: [{ source: 'https://www.legifrance.gouv.fr', copy, chars: 0 }], status: 'done' };
}

test('une décision d’une analyse tabulaire en mode recherche est résolue par son identifiant et ses alias', async () => {
  const folder = caseFolder({
    '20-01-01 - Analyse Tabulaire - Recherche.json': {
      category: 'recherche-juridique',
      rows: [researchRow('JURITEXT900000000001', 'docs/Cour de cassation.md', ['900000000000000000000001'])],
    },
  }, { 'docs/Cour de cassation.md': DECISION_TEXT });

  const resolve = createDecisionTextResolver([folder]);

  assert.equal(await resolve('JURITEXT900000000001'), DECISION_TEXT);
  assert.equal(await resolve('900000000000000000000001'), DECISION_TEXT);
});

test('une analyse tabulaire hors recherche juridique n’est pas une source de décision', async () => {
  const folder = caseFolder({
    '20-01-01 - Analyse Tabulaire - Pièces.json': {
      category: 'tri-des-pieces',
      rows: [researchRow('JURITEXT900000000002', 'docs/Pièce.md')],
    },
  }, { 'docs/Pièce.md': DECISION_TEXT });

  assert.equal(await createDecisionTextResolver([folder])('JURITEXT900000000002'), '');
});

test('une copie qui sort du dossier Tabular Review est ignorée', async () => {
  const folder = caseFolder({
    '20-01-01 - Analyse Tabulaire - Recherche.json': {
      category: 'recherche-juridique',
      rows: [researchRow('JURITEXT900000000003', '../Hors.md')],
    },
  }, {});
  fs.writeFileSync(path.join(folder, 'Hors.md'), DECISION_TEXT);

  assert.equal(await createDecisionTextResolver([folder])('JURITEXT900000000003'), '');
});
