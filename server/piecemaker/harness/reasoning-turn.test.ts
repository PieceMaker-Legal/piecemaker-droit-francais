import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { createReasoningService } from '@/modules/piecemaker-reasoning/index.js';
import { createNormalizedMessage } from '@/shared/utils.js';

import { withCitationInstructions, withoutCitationInstructions } from './citation-instructions.js';
import { createCitationStore } from './citation-store.js';
import { createCitationTurn } from './citation-turn.js';

async function fixture(t: test.TestContext) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pm-raisonnement-'));
  const db = new Database(':memory:');
  db.exec('CREATE TABLE projects(project_id TEXT PRIMARY KEY, project_path TEXT);');
  db.prepare('INSERT INTO projects VALUES(?,?)').run('exemple', cwd);
  t.after(async () => { db.close(); await rm(cwd, { recursive: true, force: true }); });
  return { cwd, service: createReasoningService(() => db), store: createCitationStore(path.join(cwd, '.snapshots')) };
}

const code = `#[question = "Le versement est-il dû ?"]
#[date_de_référence = date_acte]
déclaration champ d'application Q:
  entrée date_acte contenu date
  entrée approuve contenu booléen
  interne approbation condition
  résultat du condition
champ d'application Q:
  #[libellé = "Approbation"] #[selon = 1]
  règle approbation sous condition approuve conséquence rempli
  #[selon = 2]
  règle du sous condition approbation conséquence rempli
déclaration champ d'application Dossier:
  q champ Q
champ d'application Dossier:
  #[selon = 3] #[force = acte_sous_seing_privé]
  définition q.date_acte égal à |2024-03-01|
  #[selon = 3] #[force = acte_sous_seing_privé]
  définition q.approuve égal à vrai
`;

test('le contexte du raisonnement est injecté puis retiré de l’écho utilisateur', () => {
  const input = withCitationInstructions('Analyse ce dossier', 'Raisonnement enregistré (révision 2)');
  assert.match(input, /<RAISONNEMENT>/);
  assert.match(input, /révision 2/);
  assert.equal(withoutCitationInstructions(input), 'Analyse ce dossier');
});

test('un tour avec RAISONNEMENT masque le code, n’affiche plus de liste Sources et enregistre l’historique judiciaire', async (t) => {
  const { cwd, service, store } = await fixture(t);
  await writeFile(path.join(cwd, 'pv.md'), 'Le procès-verbal fictif du 1er mars 2024 constate que l’assemblée approuve.');
  const turn = createCitationTurn({ cwd, sessionId: 's', store, onVerifiedTurn: service.ingest });
  const message = (fields: Omit<Parameters<typeof createNormalizedMessage>[0], 'provider' | 'sessionId'> & { kind: 'tool_use' | 'tool_result' }) => createNormalizedMessage({ ...fields, provider: 'claude', sessionId: 's' });
  turn.observe(message({ kind: 'tool_use', toolId: 'a', toolName: 'mcp__legifrance__consulter_article', toolInput: { article_id: 'LEGIARTI000000000001' } }));
  turn.observe(message({ kind: 'tool_result', toolId: 'a', content: 'Validité: 2020-01-01 → en vigueur\nL’approbation préalable de l’assemblée est requise.' }));
  turn.observe(message({ kind: 'tool_use', toolId: 'd', toolName: 'mcp__legifrance__consulter_decision', toolInput: { text_id: 'JURITEXT000000000001' } }));
  turn.observe(message({ kind: 'tool_result', toolId: 'd', content: 'TEXTE INTÉGRAL:\n=====\nL’approbation doit précéder le versement.\nLien: https://example.org\n\nHISTORIQUE JUDICIAIRE (contrôle automatique)\nHistorique: remise en cause\n- Recours JURITEXT000000000002 du 2023-01-01 (Cour de cassation) — Solution : Cassation' }));
  const citations = [
    { ref: 1, kind: 'article', article_id: 'LEGIARTI000000000001', quotes: [{ quote: 'L’approbation préalable de l’assemblée est requise.' }] },
    { ref: 2, kind: 'case', decision_id: 'JURITEXT000000000001', quotes: [{ quote: 'L’approbation doit précéder le versement.' }] },
    { ref: 3, kind: 'document', doc_id: 'pv.md', quotes: [{ page: 1, quote: 'l’assemblée approuve' }] },
  ];
  let visible = '';
  for (const char of `Le versement paraît dû.<CITATIONS>${JSON.stringify(citations)}</CITATIONS>\n<RAISONNEMENT>${code}</RAISONNEMENT>`) visible += turn.delta(char);
  visible += turn.flush();
  assert.equal(visible, 'Le versement paraît dû.');
  const suffix = await turn.finish();
  assert.doesNotMatch(suffix, /\*\*Sources\*\*/);
  assert.match(suffix, /Raisonnement · révision 1 · Q : bloquée/);
  const snapshot = service.read(cwd);
  assert.equal(snapshot.sources.find((source) => source.kind === 'case')!.history!.status, 'remise en cause');
  assert.deepEqual(snapshot.questions[0].vigueur.map((entry) => entry.inForce), [true]);
  assert.equal(snapshot.facts.find((fact) => fact.id === 'Q.approuve')!.status, 'établi');
  assert.ok(snapshot.sources.every((source) => source.token));

  const replay = createCitationTurn({ cwd, sessionId: 's', store, recordVerification: false, onVerifiedTurn: () => { throw new Error('Rejeu interdit'); } });
  assert.equal(replay.text(`Le versement paraît dû.<CITATIONS>${JSON.stringify(citations)}</CITATIONS>\n<RAISONNEMENT>${code}</RAISONNEMENT>`), 'Le versement paraît dû.');
  assert.equal(await replay.finish(), suffix);
  assert.equal(service.read(cwd).revision, 1);
});

test('sans RAISONNEMENT, le bloc CITATIONS d’un acte garde sa liste Sources', async (t) => {
  const { cwd, service, store } = await fixture(t);
  await writeFile(path.join(cwd, 'pv.md'), 'L’assemblée approuve.');
  const turn = createCitationTurn({ cwd, sessionId: 's', store, onVerifiedTurn: service.ingest });
  turn.text(`Note 1 insérée.<CITATIONS>${JSON.stringify([{ ref: 1, kind: 'document', doc_id: 'pv.md', quotes: [{ page: 1, quote: 'L’assemblée approuve.' }] }])}</CITATIONS>`);
  assert.match(await turn.finish(), /\*\*Sources\*\*/);
  assert.equal(service.read(cwd).revision, 0);
});
