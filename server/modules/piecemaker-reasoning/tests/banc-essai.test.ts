import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import type { ReasoningProgram } from '../../../../shared/piecemaker-reasoning.js';
import { checkDraft } from '../draft.js';
import { addDuration, evaluateProgram } from '../engine.js';
import { withLibrary } from '../library.js';
import { createReasoningService } from '../program.js';

function fixture(t: test.TestContext) {
  const folder = mkdtempSync(path.join(tmpdir(), 'dossier-fictif-'));
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE projects(project_id TEXT PRIMARY KEY, project_path TEXT);
    CREATE TABLE piecemaker_nodes(project_id TEXT, id TEXT, kind TEXT, label TEXT, data_json TEXT, doc_date TEXT);
    CREATE TABLE piecemaker_links(project_id TEXT, from_node_id TEXT, to_node_id TEXT, relation TEXT);`);
  db.prepare('INSERT INTO projects VALUES(?,?)').run('exemple', folder);
  t.after(() => db.close());
  return { db, folder, service: createReasoningService(() => db) };
}

const block = (reasoning: object, citations: object[] = []) => `<CITATIONS>${JSON.stringify([...citations, { kind: 'reasoning', version: 1, ...reasoning }])}</CITATIONS>`;
const source = (id: string, ref: number, excerpt: string) => ({ id, ref, quoteIndex: 0, token: 'b'.repeat(64), document: `document:${id}.md`, title: `Pièce fictive ${id}`, excerpt, hash: id, verified: true, repaired: false, nature: 'document' as const });
const rule = { id: 'R_liberation', label: 'Le débiteur qui justifie le paiement est libéré', parameters: ['paiement'], conditions: { paiement: { label: 'Paiement justifié', burden: 'débiteur' } }, validity: { from: '2016-10-01', to: null }, expression: { ref: 'paiement' }, rationale: 'Règle fictive de test.', citations: [9] };
const ruleSource = { ...source('regle', 9, 'Règle fictive.'), document: 'article:LEGIARTI000000000001', nature: 'article' as const, validity: { from: '2016-10-01', to: null } };
const theory = { id: 'K_libere', kind: 'conclusion', label: 'Le débiteur est libéré', expression: { apply: 'R_liberation', bindings: { paiement: { ref: 'F_versement' } }, at: '2024-09-01' }, rationale: 'Application fictive.' };
const base = (snapshot: ReturnType<ReturnType<typeof createReasoningService>['read']>, id: string) => snapshot.evaluations[0].results.find((row) => row.id === id)!;

test('une promesse de paiement rapportée ne prouve pas le paiement : non établi, charge sur le débiteur', (t) => {
  const { service, folder } = fixture(t);
  service.ingest({ cwd: folder, sessionId: 's', turnId: 't1', sources: [source('courrier', 1, 'Je vous réglerai la somme la semaine prochaine.'), ruleSource], block: block({ law: [rule], facts: [{ id: 'F_versement', label: 'Le débiteur a payé', value: true, burden: 'débiteur' }], theories: [theory] }, [{ ref: 1, links: [{ target: 'F_versement', relation: 'reports' }] }]) });
  const snapshot = service.read(folder);
  assert.equal(base(snapshot, 'F_versement').proof, 'unestablished');
  assert.equal(base(snapshot, 'F_versement').value, false);
  assert.deepEqual(base(snapshot, 'K_libere').unestablished, ['F_versement']);
  assert.equal(snapshot.theories![0].matrix[0].status, 'unestablished');
  assert.equal(snapshot.theories![0].matrix[0].burden, 'débiteur');
});

test('pièce à produire, puis preuve à examiner après le scan, puis fait prouvé par citation', (t) => {
  const { service, db, folder } = fixture(t);
  const evidence = { nature: ['relevé bancaire'], mentions: ['entity:PERSONNE_1'], from: '2024-06-15' };
  service.ingest({ cwd: folder, sessionId: 's', turnId: 't1', sources: [ruleSource], block: block({ law: [rule], facts: [{ id: 'F_versement', label: 'Versement des fonds', burden: 'débiteur', evidence }], theories: [theory] }) });
  let snapshot = service.read(folder);
  assert.equal(base(snapshot, 'F_versement').proof, 'unestablished');
  assert.match(base(snapshot, 'F_versement').issues.join(' '), /Pièce à produire : relevé bancaire mentionnant entity:PERSONNE_1/);
  db.prepare('INSERT INTO piecemaker_nodes VALUES(?,?,?,?,?,?)').run('exemple', 'document:ancien', 'document', '2024-01-02_releve', JSON.stringify({ nature: 'relevé bancaire' }), '2024-01-02');
  db.prepare('INSERT INTO piecemaker_links VALUES(?,?,?,?)').run('exemple', 'document:ancien', 'entity:PERSONNE_1', 'mentions');
  assert.equal(base(service.read(folder), 'F_versement').proof, 'unestablished');
  db.prepare('INSERT INTO piecemaker_nodes VALUES(?,?,?,?,?,?)').run('exemple', 'document:releve', 'document', '2024-07-01_releve', JSON.stringify({ nature: 'Relevé bancaire' }), '2024-07-01');
  db.prepare('INSERT INTO piecemaker_links VALUES(?,?,?,?)').run('exemple', 'document:releve', 'entity:PERSONNE_1', 'mentions');
  snapshot = service.read(folder);
  assert.equal(base(snapshot, 'F_versement').proof, 'to_examine');
  assert.equal(base(snapshot, 'F_versement').status, 'unknown');
  assert.deepEqual(snapshot.program.nodes.find((node) => node.id === 'F_versement')!.evidenceCandidates!.map((piece) => piece.id), ['document:releve']);
  assert.match(snapshot.theories![0].issues.join(' '), /à réexaminer/);
  service.ingest({ cwd: folder, sessionId: 's', turnId: 't2', sources: [source('releve', 1, 'Virement de 4 000 euros.')], block: block({}, [{ ref: 1, links: [{ target: 'F_versement', relation: 'supports' }] }]) });
  snapshot = service.read(folder);
  assert.equal(base(snapshot, 'F_versement').proof, 'established');
  assert.equal(base(snapshot, 'K_libere').value, true);
});

test('la décision de l’avocat prime et verrouille la proposition', (t) => {
  const { service, folder } = fixture(t);
  const fact = { id: 'F_versement', label: 'Versement des fonds', value: true, citations: [1] };
  service.ingest({ cwd: folder, sessionId: 's', turnId: 't1', sources: [source('releve', 1, 'Virement de 4 000 euros.')], block: block({ facts: [fact] }) });
  assert.equal(base(service.review(folder, 'F_versement', 'rejected', 'Relevé illisible'), 'F_versement').proof, 'unestablished');
  const reply = service.ingest({ cwd: folder, sessionId: 's', turnId: 't2', sources: [source('releve', 1, 'Virement de 4 000 euros.')], block: block({ facts: [fact], remove: ['F_versement'] }) });
  assert.match(reply, /verrouillé/);
  const snapshot = service.read(folder);
  assert.equal(snapshot.program.nodes.find((node) => node.id === 'F_versement')!.review!.note, 'Relevé illisible');
  assert.equal(base(service.review(folder, 'F_versement', null), 'F_versement').proof, 'established');
});

test('une proposition invalide est écartée sans faire tomber le reste du programme', (t) => {
  const { service, folder } = fixture(t);
  const reply = service.ingest({ cwd: folder, sessionId: 's', turnId: 't1', sources: [source('courriel', 1, 'La seconde tranche est suspendue.')], block: block({ facts: [
    { id: 'F_engagement', label: 'Engagement de financement', value: true, citations: [1] },
    { id: 'F_jour', label: 'Virement du jour', evidence: { nature: ['relevé bancaire'], from: '2025-02-21', to: '2025-02-21' } },
    { id: 'F_suspension', label: 'Suspension de la seconde tranche', relation: { subject: 'entity:SOCIETE_1', predicate: 'suspend', object: 'tranche_2' } },
  ], theories: [
    { id: 'C_delai', kind: 'calculation', label: 'Délai en jours', expression: { op: 'daysBetween', args: ['2025-03-12', '2025-03-20'] }, value: 8, rationale: 'Calcul fictif.' },
    { id: 'K_engagement', label: 'Engagement retenu', expression: { ref: 'F_engagement' }, rationale: 'Conclusion fictive.' },
  ], tests: [
    { id: 'T_mal_forme', label: 'Attente en texte libre', target: 'K_engagement', expect: 'retenu' },
    { id: 'T_engagement', label: 'Engagement retenu', target: 'K_engagement', expected: { status: 'known', value: true }, rationale: 'Pièce citée.' },
  ], links: [{ id: 'L_orphelin', from: 'F_engagement', to: 'F_inexistant', relation: 'precedes' }] }, [{ ref: 1, links: [{ target: 'F_suspension', relation: 'reports' }, { target: 'R_inconnue', relation: 'supports' }] }, { ref: 7, links: [{ target: 'F_engagement', relation: 'supports' }] }]) });
  assert.match(reply, /Lien de citation vers R_inconnue écarté : proposition absente/);
  assert.match(reply, /Lien de citation \[7\] vers F_engagement écarté : citation introuvable/);
  assert.match(reply, /F_suspension écarté : Relation factuelle invalide/);
  assert.match(reply, /L_orphelin écarté : Lien de raisonnement invalide/);
  assert.match(reply, /F_jour écarté : Exigence de preuve invalide/);
  assert.match(reply, /C_delai écarté : Expression attendue/);
  assert.match(reply, /T_mal_forme écarté : Attente invalide/);
  const snapshot = service.read(folder);
  assert.deepEqual(snapshot.program.nodes.map((node) => node.id), ['F_engagement', 'K_engagement']);
  assert.deepEqual(snapshot.program.tests.map((test) => test.id), ['T_engagement']);
  assert.equal(base(snapshot, 'F_engagement').proof, 'established');
});

test('durées : même quantième, dernier jour du mois à défaut, jours calendaires', () => {
  assert.equal(addDuration('2024-01-31', 1, 'months'), '2024-02-29');
  assert.equal(addDuration('2020-02-29', 5, 'years'), '2025-02-28');
  assert.equal(addDuration('2024-12-31', 1, 'days'), '2025-01-01');
  assert.equal(addDuration('2024-03-31', -1, 'months'), '2024-02-29');
});

test('module de bibliothèque : prescription quinquennale au dernier jour du terme', () => {
  for (const [action, expected] of [['2024-03-10', false], ['2024-03-11', true]] as const) {
    const program = withLibrary({ version: 1, sources: [source('pieces', 1, 'Pièces fictives.')], scenarios: [], tests: [], nodes: [
      { id: 'F_connaissance', kind: 'fact', layer: 'fact', label: 'Connaissance des faits', value: '2019-03-10', sources: ['pieces'] },
      { id: 'F_action', kind: 'fact', layer: 'fact', label: 'Assignation', value: action, sources: ['pieces'] },
      { id: 'K_prescrite', kind: 'conclusion', layer: 'theory', label: 'Action prescrite', rationale: 'Test.', sources: [], expression: { apply: 'LIB_prescription_2224', bindings: { connaissance: { ref: 'F_connaissance' }, action: { ref: 'F_action' } }, at: { ref: 'F_action' } } },
    ] } as ReasoningProgram);
    const result = evaluateProgram(program)[0].results.find((row) => row.id === 'K_prescrite')!;
    assert.equal(result.status, 'known');
    assert.equal(result.value, expected);
  }
});

test('deux exceptions applicables à la fois sont un conflit, une seule s’applique', () => {
  const program = (second: boolean): ReasoningProgram => ({ version: 1, scenarios: [], tests: [], sources: [{ ...ruleSource, id: 'regle' }], nodes: [
    { id: 'R_taux', kind: 'rule', layer: 'law', label: 'Taux fictif', parameters: ['a', 'b'], validity: { from: '2016-10-01', to: null }, rationale: 'Test.', sources: ['regle'], expression: 1, exceptions: [{ id: 'E1', label: 'Première exception', when: { ref: 'a' }, then: 2 }, { id: 'E2', label: 'Seconde exception', when: { ref: 'b' }, then: 3 }] },
    { id: 'K_taux', kind: 'conclusion', layer: 'theory', label: 'Taux', rationale: 'Test.', sources: [], expression: { apply: 'R_taux', bindings: { a: true, b: second }, at: '2024-01-01' } },
  ] });
  assert.equal(evaluateProgram(program(true))[0].results.find((row) => row.id === 'K_taux')!.status, 'error');
  assert.equal(evaluateProgram(program(false))[0].results.find((row) => row.id === 'K_taux')!.value, 2);
});

test('le contrôle de rédaction signale un montant ou une date absents du raisonnement et les réserves', async (t) => {
  const { service, folder } = fixture(t);
  service.ingest({ cwd: folder, sessionId: 's', turnId: 't1', sources: [source('facture', 1, 'Montant de 12 000 euros.')], block: block({ facts: [
    { id: 'F_facture', label: 'Montant facturé (centimes)', value: 1200000, citations: [1], relation: { subject: 'entity:SOCIETE_1', predicate: 'facture', object: 'entity:PERSONNE_1', context: 'facture_1', unit: 'centime', eventDate: '2024-06-15' } },
    { id: 'F_versement', label: 'Versement de 4 500 euros', state: 'disputed', value: 450000 },
  ] }) });
  writeFileSync(path.join(folder, 'projet.md'), 'La facture du 15/06/2024 s’élève à 12 000 €. Un versement de 4 500 € est intervenu le 2 juillet 2024.');
  const check = await checkDraft(folder, 'projet.md', service.read(folder));
  assert.deepEqual(check.findings.filter((finding) => finding.kind !== 'reserve').map((finding) => finding.text), ['4 500 €', '2 juillet 2024']);
  assert.equal(check.findings.find((finding) => finding.kind === 'reserve')!.text, 'Versement de 4 500 euros');
  await assert.rejects(checkDraft(folder, '../hors.md', service.read(folder)));
});
