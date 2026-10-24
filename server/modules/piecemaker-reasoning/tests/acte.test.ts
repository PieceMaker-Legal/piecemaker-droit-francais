import assert from 'node:assert/strict';
import test from 'node:test';

import { EXAMPLE_CODE, EXAMPLE_SOURCES, verifyReasoning } from '../program.js';
import { markup, quotations, segments } from '../acte.js';
import { parseLiteral } from '../format.js';

const ACTE = `  acte: [
    { intitule: \`Faits\`, texte: [\`Le contrat stipule qu’« En cas de retard de livraison », une pénalité est due, et la marchandise a été livrée tardivement : « Livré le 14/06/2025 ».\`] },
    { intitule: \`Sur la pénalité\`, traite: 'pénalité_encourue', texte: [
      \`L’article prévoit que « la pénalité n’est encourue que lorsque le débiteur est mis en demeure ».\`,
      \`**La pénalité est donc due.**\`,
    ] },
  ],
`;
const withActe = (acte: string) => EXAMPLE_CODE.replace(/\}\s*$/, `${acte}}\n`);

const verify = (code: string) => verifyReasoning({
  code, cwd: '/dossier-fictif',
  connectors: {
    source: async (_cwd, id) => (/^LEGIARTI\d+$/.test(id) || id.includes('/') ? EXAMPLE_SOURCES[id] ?? null : undefined),
    match: (text, excerpt) => (text.includes(excerpt) ? excerpt : null),
    registry: async () => ({ found: true, status: 'active' }),
    bodacc: async () => [],
  },
  reliability: new Map(), nature: () => null, persons: [], dismissed: new Set(),
});
const acteIssues = (result: Awaited<ReturnType<typeof verify>>) => result.issues.filter((issue) => issue.path.startsWith('acte') || /acte/.test(issue.text)).map((issue) => `${issue.kind} ${issue.path} : ${issue.text}`);

test('l’acte se range en dernier, reçoit des id et garde un paragraphe par ligne', async () => {
  const result = await verify(withActe(ACTE));
  const value = parseLiteral(result.code).value as Record<string, any>;
  assert.equal(Object.keys(value).at(-1), 'acte');
  assert.deepEqual(value.acte.map((section: { id: string }) => section.id), ['s1', 's2']);
  assert.ok(result.code.includes("\n        '**La pénalité est donc due.**',\n"));
  assert.deepEqual(acteIssues(result), [
    'manque acte[1].traite : pénalité_encourue est à établir dans le raisonnement : établis-le, ou rédige la section comme une prétention à démontrer',
    'manque acte : obstacle force_majeure_contractuelle non discuté dans l’acte : ajoute traite: \'force_majeure_contractuelle\' à la section qui y répond',
  ]);
});

test('une citation de l’acte doit figurer dans ce que la section traite', async () => {
  const invented = ACTE.replace('**La pénalité est donc due.**', 'Le débiteur a reconnu « avoir livré avec deux mois de retard ».');
  const misplaced = ACTE.replace('traite: \'pénalité_encourue\'', 'traite: \'grève\'');
  const inventedIssues = acteIssues(await verify(withActe(invented)));
  assert.ok(inventedIssues.some((text) => text.startsWith('erreur acte[1].texte[1] : citation absente du raisonnement : « avoir livré avec deux mois de retard »')), inventedIssues.join('\n'));
  const misplacedIssues = acteIssues(await verify(withActe(misplaced)));
  assert.ok(misplacedIssues.some((text) => text.startsWith('erreur acte[1].texte[0] : citation absente du raisonnement')), misplacedIssues.join('\n'));
  assert.ok(misplacedIssues.some((text) => text.startsWith('manque acte[1].traite : grève est à établir')), misplacedIssues.join('\n'));
});

test('l’acte doit développer chaque objectif et renvoyer à des éléments existants', async () => {
  const result = await verify(withActe(ACTE.replace('traite: \'pénalité_encourue\'', 'traite: \'pénalité_inventée\'')));
  const issues = result.issues.map((issue) => `${issue.kind} ${issue.path} : ${issue.text}`);
  assert.ok(issues.some((text) => text.startsWith('erreur acte[1].traite : traite : pénalité_inventée n’est ni un terme')));
  assert.ok(issues.some((text) => text.startsWith('manque objectifs[0] : objectif non développé dans l’acte')));
});

test('un conflit de fusion bloque jusqu’à ce qu’il soit tranché', async () => {
  const conflicted = ACTE.replace('{ intitule: `Faits`,', '{ intitule: `Faits`, conflit: [{ sur: \'texte\', modele: [\'A\'], avocat: [\'B\'] }],');
  assert.ok(acteIssues(await verify(withActe(conflicted))).some((text) => text.startsWith('erreur acte[0].conflit : conflit de fusion sur le texte')));
});

test('gras et italique font l’aller-retour', () => {
  const text = 'Le **contrat *signé*** prévoit « trois mots ici » et *rien* d’autre.';
  assert.equal(markup(segments(text)), text);
  assert.deepEqual(quotations(text), ['trois mots ici']);
});
