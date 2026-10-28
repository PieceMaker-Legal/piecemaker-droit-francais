import assert from 'node:assert/strict';
import test from 'node:test';

import { parseReasoningDocument, printReasoningDocument } from '../document.js';
import { readReasoning } from '../format.js';
import { adviseNames } from '../names.js';
import { describeReasoning, EXAMPLE_CODE, EXAMPLE_SOURCES, verifyReasoning } from '../program.js';
import type { ReasoningConnectors } from '../program.js';
import type { ReasoningIssue } from '../../../../shared/piecemaker-reasoning.js';

const connectors: ReasoningConnectors = {
  source: async (_cwd, id) => EXAMPLE_SOURCES[id] ?? null,
  match: (text, excerpt) => text.includes(excerpt) ? excerpt : null,
  registry: async () => ({ found: true, status: 'active' }),
  bodacc: async () => [],
};
const verify = (code: string) => verifyReasoning({ code, cwd: '/dossier-fictif', connectors, reliability: new Map(), persons: [], nature: () => null, dismissed: new Set() });
const plainFrench = (name: string) => name.replace(/(^|_)([dl])_(?=[aeiouyhàâéèêëîïôûù])/gu, "$1$2'").replace(/_/g, ' ');

function spacedExample() {
  const value = parseReasoningDocument(EXAMPLE_CODE).value;
  const { reasoning } = readReasoning(value);
  const names = new Set([...reasoning.terms.keys(), ...reasoning.valeurs.keys()]);
  for (const term of reasoning.terms.values()) for (const condition of [...term.si, ...term.sauf]) for (const entry of condition.l_une ?? [condition]) names.add(entry.condition!);
  let yaml = printReasoningDocument(value);
  for (const name of [...names].sort((x, y) => y.length - x.length)) yaml = yaml.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${name}(?![\\p{L}\\p{N}_])`, 'gu'), plainFrench(name));
  return { underscored: printReasoningDocument(value), spaced: yaml };
}

test('un nom en français avec des espaces se vérifie comme son équivalent avec des _', async () => {
  const { underscored, spaced } = spacedExample();
  assert.ok(spaced.includes('applicabilité de l\'article'));
  const before = await verify(underscored);
  const after = await verify(spaced);
  const count = (issues: ReasoningIssue[], kind: string) => issues.filter((issue) => issue.kind === kind).length;
  assert.equal(count(after.issues, 'erreur'), count(before.issues, 'erreur'));
  assert.equal(count(after.issues, 'manque'), count(before.issues, 'manque'));
  assert.deepEqual(after.log.map((entry) => entry.status), before.log.map((entry) => entry.status));
  assert.ok(after.issues.every((issue) => !/(applicabilité|décompte|validité|prescription)_de_/.test(issue.text)));
  assert.equal((await verify(after.code)).code, after.code);
});

test('un nom ne peut pas contenir deux espaces ni finir par une espace', () => {
  const { problems } = readReasoning({ objectifs: [{ objectif: 'Obtenir la pénalité', obtenir: 'pénalité  due' }], 'pénalité  due': { si: [{ 'retard constaté': true }] } });
  assert.ok(problems.some((problem) => problem.text.startsWith('nom de terme invalide')));
});

test('deux noms pour un même fait sont signalés, deux faits voisins ne le sont pas', () => {
  const advice = (names: string[]) => adviseNames(names).map((entry) => entry.text);
  assert.equal(advice(['obligation née entre professionnels dans le commerce', 'obligations nées entre professionnels']).length, 1);
  assert.equal(advice(['facture 014 échue', 'facture_014_échue']).length, 1);
  assert.deepEqual(advice(['facture 014 échue', 'facture 021 échue']), []);
  assert.deepEqual(advice(['livraison reçue', 'livraison reçue sans réserve']), []);
  assert.deepEqual(advice(['réclamation dans les huit jours', 'décompte de réclamation dans les huit jours']), []);
  assert.deepEqual(advice(['constructor', 'toString']), []);
});

test('un nom qui relie deux faits par et, ou, sauf est signalé', () => {
  const [entry] = adviseNames(['livraison reçue et conforme']);
  assert.match(entry.text, /« et »/);
  assert.match(entry.text, /sous si/);
  assert.match(adviseNames(['force majeure ou grève'])[0].text, /l_une/);
  assert.deepEqual(adviseNames(['mise en demeure reçue']), []);
});

test('les conseils ne sont ni des erreurs ni des manques et n’apparaissent qu’une fois les erreurs corrigées', async () => {
  const { spaced } = spacedExample();
  const duplicated = spaced.replace(/- inexécution définitive: true\n/, '- mises en demeure: true\n');
  assert.notEqual(duplicated, spaced);
  const result = await verify(duplicated);
  assert.ok(result.issues.some((issue) => issue.kind === 'conseil'));
  const bilan = result.annotated?.bilan as { erreurs: number; manques: number; ecartees: number };
  assert.equal(bilan.erreurs, result.issues.filter((issue) => issue.kind === 'erreur').length);
  assert.equal(bilan.manques, result.issues.filter((issue) => issue.kind === 'manque').length);
  assert.equal(bilan.ecartees, 0);

  const advice = Array.from({ length: 7 }, (_, index): ReasoningIssue => ({ id: `c${index}`, kind: 'conseil', path: '', line: null, text: `conseil ${index}` }));
  const error: ReasoningIssue = { id: 'e', kind: 'erreur', path: '', line: null, text: 'erreur fictive' };
  assert.doesNotMatch(describeReasoning({ code: '', issues: [error, ...advice] }), /CONSEIL/);
  const shown = describeReasoning({ code: '', issues: advice });
  assert.equal(shown.match(/^CONSEIL /gm)?.length, 5);
  assert.match(shown, /5 conseil\(s\) d’écriture/);
});

test('une clé avec des espaces est un nom à sa place, une phrase coupée par « : » ailleurs', () => {
  const named = parseReasoningDocument('valeurs:\n  date de commande:\n    valeur: 2025-05-02\npénalité due:\n  si:\n    - mise en demeure: true\nhypotheses:\n  - nom: cas\n    faits:\n      mise en demeure: true\n    attendu:\n      pénalité due: true\n');
  assert.ok(Object.hasOwn(named.value as object, 'pénalité due'));
  assert.throws(() => parseReasoningDocument('acte:\n  - intitule: Sur la pénalité\n    texte:\n      - Le contrat impose: une livraison\n'), /guillemets/);
});
