import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { EXAMPLE_CODE, EXAMPLE_SOURCES, createReasoningService, describeReasoning, verifyReasoning } from '../program.js';
import type { ReasoningConnectors, SourceInfo } from '../program.js';
import { addDuration } from '../engine.js';
import { parseLiteral } from '../format.js';

const plain = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const connectors = (sources: Record<string, SourceInfo> = EXAMPLE_SOURCES): ReasoningConnectors => ({
  source: async (_cwd, id) => (/^(LEGIARTI|JURITEXT)\d+$/.test(id) || id.includes('/') ? sources[id] ?? null : undefined),
  match: (text, excerpt) => {
    if (text.includes(excerpt)) return excerpt;
    const found = new RegExp(plain(excerpt).split(' ').join('[^\\p{L}\\p{N}]+'), 'iu').exec(text);
    return found ? found[0] : null;
  },
  registry: async () => ({ found: true, status: 'active' }),
  bodacc: async () => [],
});

const verify = (code: string, options: { reliability?: Map<string, boolean>; dismissed?: Set<string> } = {}) => verifyReasoning({
  code, cwd: '/dossier-fictif', connectors: connectors(),
  reliability: options.reliability ?? new Map(), nature: (piece) => (piece.includes('contrat') ? 'contrat' : null),
  persons: [{ label: 'Société Beta SARL', kind: 'company', name: null, siren: null }],
  dismissed: options.dismissed ?? new Set(),
});

const at = (annotated: unknown, route: string) => route.split(/\.|\[|\]/).filter(Boolean).reduce<any>((value, key) => value?.[key], annotated);
const texts = (result: Awaited<ReturnType<typeof verify>>, kind: 'erreur' | 'manque') => result.issues.filter((issue) => issue.kind === kind).map((issue) => `${issue.path} : ${issue.text}`);

test('le fichier est lu sans être exécuté : fonctions, appels, variables et commentaires sont refusés', () => {
  assert.equal((parseLiteral('export default { a: [1, `x`, vrai, null], b: { c: -2 } };').value as any).b.c, -2);
  for (const code of ['{ a: () => 1 }', '{ a: require("fs") }', '{ a: process }', '{ a: `${x}` }', '{ a: 1 } // note', '{ a: 1 }; alert(1)', '{ a: 1, a: 2 }']) {
    assert.throws(() => parseLiteral(code), /ligne \d+/, code);
  }
});

test('l’exemple fictif est à établir et désigne les faits décisifs', async () => {
  const result = await verify(EXAMPLE_CODE);
  assert.deepEqual(texts(result, 'erreur'), []);
  assert.equal(at(result.annotated, 'questions[0].statut'), 'à établir');
  assert.deepEqual(at(result.annotated, 'questions[0].decisifs'), ['force_majeure', 'grève_nationale']);
  assert.deepEqual(at(result.annotated, 'questions[0].personnes'), ['Société Beta SARL']);
  assert.equal(at(result.annotated, 'pénalité_stipulée.si[0].statut'), 'acquis');
  assert.equal(at(result.annotated, 'grève.si[0].l_une[1].statut'), 'exclu');
  assert.equal(at(result.annotated, 'force_majeure_contractuelle.si[0].l_une[0].decisif'), true);
  assert.equal(at(result.annotated, 'bilan.essais'), '1/1');
  assert.equal(at(result.annotated, 'pénalité_encourue.si[0].selon[0].titre'), 'Code civil fictif, article 1231-5');
  assert.equal(at(result.annotated, 'pénalité_encourue.si[0].selon[0].en_vigueur'), true);
  assert.match(describeReasoning(result), /decisifs: \[`force_majeure`, `grève_nationale`\]/);
});

test('toutes les feuilles établies : la réponse est acquise ; la preuve de l’exception l’exclut', async () => {
  const closed = EXAMPLE_CODE
    .replace("{ condition: 'force_majeure' }", "{ condition: 'force_majeure', contredit: [{ piece: 'pieces/07_courriel.md', citation: `a duré deux jours` }] }")
    .replace("{ condition: 'grève_nationale' }", "{ condition: 'grève_nationale', contredit: [{ piece: 'pieces/07_courriel.md', citation: `mouvement limité à notre atelier` }] }");
  assert.equal(at((await verify(closed)).annotated, 'questions[0].statut'), 'acquis');
  const excused = EXAMPLE_CODE.replace("{ condition: 'grève_nationale' }", "{ condition: 'grève_nationale', preuve: [{ piece: 'pieces/07_courriel.md', citation: `mouvement limité à notre atelier` }] }");
  assert.equal(at((await verify(excused)).annotated, 'questions[0].statut'), 'exclu');
});

test('une citation à la ponctuation près est validée et remplacée par l’original ; une citation fausse est une erreur', async () => {
  const comma = await verify(EXAMPLE_CODE.replace('`Sauf inexécution définitive`', '`Sauf, inexécution définitive`'));
  assert.equal(at(comma.annotated, 'pénalité_encourue.si[1].selon[0].corrigee'), true);
  assert.equal(at(comma.annotated, 'pénalité_encourue.si[1].selon[0].citation'), 'Sauf inexécution définitive');
  assert.match(comma.code, /`Sauf inexécution définitive`/);
  const wrong = await verify(EXAMPLE_CODE.replace('`Sauf inexécution définitive`', '`Sauf exécution partielle`'));
  assert.match(texts(wrong, 'erreur').join('\n'), /pénalité_encourue\.si\[1\]\.selon\[0\] : citation introuvable/);
});

test('la vigueur est une condition appréciée à la date que chaque texte désigne : absente ou dépassée c’est un manque, fausse une erreur, et chaque article dit pourquoi il s’applique', async () => {
  const missing = await verify(EXAMPLE_CODE.replace("débiteur est mis en demeure`, vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_conclusion_du_contrat' }", 'débiteur est mis en demeure`'));
  assert.match(texts(missing, 'manque').join('\n'), /pénalité_encourue\.si\[0\]\.selon\[0\]\.vigueur : vigueur non renseignée.*debut '2016-10-01'/);
  assert.deepEqual(texts(missing, 'erreur'), []);
  const differs = await verify(EXAMPLE_CODE.replace("débiteur est mis en demeure`, vigueur: { debut: '2016-10-01'", "débiteur est mis en demeure`, vigueur: { debut: '2016-02-10'"));
  assert.match(texts(differs, 'erreur').join('\n'), /vigueur différente de la version citée : debut '2016-10-01'/);
  const late = await verify(EXAMPLE_CODE.replace("valeur: '2024-01-15'", "valeur: '2015-06-14'"));
  assert.equal(at(late.annotated, 'questions[0].statut'), 'exclu');
  assert.match(texts(late, 'manque').join('\n'), /selon\[0\]\.vigueur : version non applicable : elle n’était pas en vigueur au 2015-06-14/);
  const undated = await verify(EXAMPLE_CODE.replaceAll(", au: 'date_de_conclusion_du_contrat'", ''));
  assert.equal(at(undated.annotated, 'questions[0].statut'), 'à établir');
  assert.match(texts(undated, 'manque').join('\n'), /pénalité_encourue\.si\[0\]\.selon\[0\]\.vigueur : applicabilité dans le temps non établie : ajoute vigueur: \{ debut, fin, au:/);
  assert.equal(undated.issues.find((entry) => entry.path === 'pénalité_encourue.si[0].selon[0].vigueur' && entry.text.startsWith('applicabilité dans le temps'))!.avocat, 'Code civil fictif, article 1231-5 : l’applicabilité du texte dans le temps n’est pas établie.');
  const unproven = await verify(EXAMPLE_CODE.replace(", preuve: [{ piece: 'pieces/01_contrat.md', citation: `Fait le 15/01/2024` }] }", ' }'));
  assert.match(texts(unproven, 'manque').join('\n'), /selon\[0\]\.vigueur : date_de_conclusion_du_contrat : renseigne cette date dans valeurs, avec sa preuve/);
  assert.match(texts(await verify(EXAMPLE_CODE.replace("valeur: '2024-01-15'", 'valeur: 12')), 'erreur').join('\n'), /date_de_conclusion_du_contrat sert à .*\.au : une date 'AAAA-MM-JJ' attendue/);
  assert.match(texts(await verify(EXAMPLE_CODE.replace("reponse: 'pénalité_encourue',", "reponse: 'pénalité_encourue', date: { valeur: '2025-06-14' },")), 'erreur').join('\n'), /questions\[0\]\.date : clé inconnue date/);
});

test('l’applicabilité d’un texte est un terme : ses conditions, sourcées et prouvées, décident si le texte s’applique', async () => {
  const unjustified = await verify(EXAMPLE_CODE.replace(", applicabilite: 'applicabilité_de_l_article_1231_5' }] },", " }] },"));
  assert.match(texts(unjustified, 'manque').join('\n'), /pénalité_encourue\.si\[0\]\.selon\[0\]\.applicabilite : applicabilité non établie : ajoute applicabilite:/);
  const result = await verify(EXAMPLE_CODE);
  assert.doesNotMatch(texts(result, 'manque').join('\n'), /applicabilite/);
  assert.equal(at(result.annotated, 'applicabilité_de_l_article_1231_5.statut'), 'acquis');
  assert.doesNotMatch(texts(result, 'manque').join('\n'), /applicabilité_de_l_article_1231_5 : terme qui ne sert/);
  const inapplicable = await verify(EXAMPLE_CODE.replace("preuve: [{ piece: 'pieces/01_contrat.md', citation: `une pénalité est due` }] },", "contredit: [{ piece: 'pieces/01_contrat.md', citation: `une pénalité est due` }] },"));
  assert.equal(at(inapplicable.annotated, 'applicabilité_de_l_article_1231_5.statut'), 'exclu');
  assert.equal(at(inapplicable.annotated, 'pénalité_encourue.si[0].statut'), 'exclu');
  assert.equal(at(inapplicable.annotated, 'questions[0].statut'), 'exclu');
  const unproven = await verify(EXAMPLE_CODE.replace("\n        preuve: [{ piece: 'pieces/01_contrat.md', citation: `une pénalité est due` }] },", ' },'));
  assert.ok(at(unproven.annotated, 'questions[0].decisifs').includes('contrat_stipulant_une_pénalité'));
  const errors = texts(await verify(EXAMPLE_CODE.replace("applicabilite: 'applicabilité_de_l_article_1231_5' }] },", "applicabilite: 'applicabilité_inconnue' }] },").replace("applicabilite: 'applicabilité_de_l_article_1231_5' }] },", 'applicabilite: `un contrat` }] },')), 'erreur').join('\n');
  assert.match(errors, /selon\[0\]\.applicabilite : terme applicabilité_inconnue non défini/);
  assert.match(errors, /selon\[0\]\.applicabilite : applicabilite : nom du terme qui établit que ce texte s’applique, commençant par applicabilité_/);
});

test('une condition sans source, un terme non défini, une boucle et un essai non conforme sont des erreurs', async () => {
  const errors = texts(await verify(`{
    questions: [{ question: \`Question fictive ?\`, reponse: 'a' }, { question: \`Autre ?\`, reponse: 'absent' }],
    a: { si: [{ condition: 'b', selon: [{ source: 'LEGIARTI000000000005', citation: \`Sauf inexécution définitive\` }] }, { condition: 'c' }] },
    b: { si: [{ condition: 'a', selon: [{ source: 'LEGIARTI000000000005', citation: \`Sauf inexécution définitive\` }] }] },
    essais: [{ nom: \`faux\`, faits: { c: vrai }, attendu: { c: faux } }],
  }`), 'erreur').join('\n');
  assert.match(errors, /a\.si\[1\]\.selon : condition sans source/);
  assert.match(errors, /questions\[1\]\.reponse : terme absent non défini/);
  assert.match(errors, /boucle : a → b → a/);
});

test('un essai rejoue le droit seul et signale un résultat contraire à l’attendu', async () => {
  const result = await verify(EXAMPLE_CODE.replace('attendu: { pénalité_encourue: faux }', 'attendu: { pénalité_encourue: vrai }'));
  assert.equal(at(result.annotated, 'essais[0].conforme'), false);
  assert.match(texts(result, 'erreur').join('\n'), /essais\[0\] : essai non conforme : obtenu pénalité_encourue = faux/);
});

test('une source d’un autre droit est acceptée mais signalée comme non vérifiable', async () => {
  const result = await verify(EXAMPLE_CODE.replace("source: 'LEGIARTI000000000005', citation: `Sauf inexécution définitive`", "source: 'CELEX:00000X0000', citation: `Sauf inexécution définitive`"));
  assert.match(texts(result, 'manque').join('\n'), /source non vérifiable automatiquement : aucun connecteur pour CELEX:00000X0000/);
  assert.deepEqual(texts(result, 'erreur'), []);
});

test('une pièce non fiable ne prouve rien ; une pièce non évaluée est signalée', async () => {
  const result = await verify(EXAMPLE_CODE, { reliability: new Map([['pieces/06_mise_en_demeure.md', false]]) });
  assert.equal(at(result.annotated, 'pénalité_encourue.si[1].l_une[0].statut'), 'à établir');
  assert.equal(at(result.annotated, 'pénalité_encourue.si[1].l_une[0].preuve[0].fiable'), false);
  assert.ok(!at(result.annotated, 'bilan.pieces_a_evaluer_par_l_avocat').includes('pieces/06_mise_en_demeure.md'));
  assert.ok(at(result.annotated, 'bilan.pieces_a_evaluer_par_l_avocat').includes('pieces/07_courriel.md'));
});

test('une alerte écartée par l’avocat n’est plus émise, et revient si l’élément change', async () => {
  const first = await verify(EXAMPLE_CODE);
  const target = first.issues.find((issue) => issue.text.startsWith('force_majeure décide'))!;
  const dismissed = await verify(EXAMPLE_CODE, { dismissed: new Set([target.id]) });
  assert.equal(at(dismissed.annotated, 'bilan.ecartees'), 1);
  assert.equal(at(dismissed.annotated, 'force_majeure_contractuelle.si[0].l_une[0].manques'), undefined);
  const changed = await verify(EXAMPLE_CODE.replace("condition: 'force_majeure' }", "condition: 'cas_de_force_majeure' }"), { dismissed: new Set([target.id]) });
  assert.equal(at(changed.annotated, 'bilan.ecartees'), 0);
});

test('le service lit le fichier du dossier, corrige les citations, enregistre les décisions de l’avocat', async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'raisonnement-'));
  fs.mkdirSync(path.join(folder, '.piecemaker'));
  const file = path.join(folder, '.piecemaker', 'raisonnement.js');
  fs.writeFileSync(file, EXAMPLE_CODE.replace('`Sauf inexécution définitive`', '`sauf inexécution définitive`'));
  const db = new Database(':memory:');
  db.exec('CREATE TABLE projects(project_id TEXT PRIMARY KEY, project_path TEXT);');
  db.prepare('INSERT INTO projects VALUES(?,?)').run('fictif', folder);
  t.after(() => { db.close(); fs.rmSync(folder, { recursive: true, force: true }); });
  const service = createReasoningService(() => db, connectors());
  db.prepare('INSERT INTO pm_reasoning_programs VALUES(?,?,?,?)').run('fictif', 3, 'ancien format', JSON.stringify({ code: 'ancien format', questions: [] }));
  assert.equal(service.read(folder).code, '');
  const text = await service.command(folder, { commande: 'verifier' });
  assert.match(text, /^\{\n {2}bilan: \{/);
  assert.match(fs.readFileSync(file, 'utf8'), /`Sauf inexécution définitive`/);
  const issue = service.read(folder).issues.find((entry) => entry.kind === 'manque')!;
  assert.equal((await service.dismiss(folder, issue.id)).dismissed.length, 1);
  assert.equal((await service.dismiss(folder, issue.id, true)).dismissed.length, 0);
  assert.equal((await service.rate(folder, 'pieces/06_mise_en_demeure.md', false)).reliability[0].reliable, false);
  await assert.rejects(service.command(folder, { commande: 'condition' }), /Commande : verifier/);
  fs.rmSync(file);
  await assert.rejects(service.verify(folder), /Aucun raisonnement/);
});

test('le test se déroule ligne par ligne : sources, pièces, faits, termes, essais, réponse', async () => {
  const seen: string[] = [];
  const result = await verifyReasoning({
    code: EXAMPLE_CODE, cwd: '/dossier-fictif', connectors: connectors(), reliability: new Map(), nature: () => null,
    persons: [], dismissed: new Set(), emit: (entry) => seen.push(`${entry.step}:${entry.status}`),
  });
  assert.ok(seen.indexOf('source:en cours') < seen.indexOf('source:ok'));
  assert.deepEqual([...new Set(result.log.map((entry) => entry.step))], ['source', 'pièce', 'fait', 'condition', 'essai', 'réponse']);
  assert.match(result.log.find((entry) => entry.key === 'fait:retard_de_livraison')!.text, /Prouvé par Bon de livraison \(fictif\) : « /);
  assert.match(result.log.find((entry) => entry.step === 'réponse')!.text, /En suspens : dépend de force majeure et grève nationale/);
});

test('seules les parties sociétés du dossier passent au registre et au BODACC', async () => {
  const checked: string[] = [];
  const result = await verifyReasoning({
    code: EXAMPLE_CODE, cwd: '/dossier-fictif', online: true,
    connectors: { ...connectors(), registry: async ({ name }) => { checked.push(String(name)); return { found: true, status: 'active' }; }, bodacc: async () => ['procédure collective : redressement judiciaire ouvert le 02/05/2025'] },
    reliability: new Map(), nature: () => null, dismissed: new Set(),
    persons: [
      { label: 'Société Beta SARL', kind: 'company', name: null, siren: '123456789', side: 'adversaire' },
      { label: 'Société Exemple SAS', kind: 'company', name: null, siren: null, side: 'client' },
      { label: 'Société Tiers SA', kind: 'company', name: null, siren: '987654321', side: 'tiers' },
    ],
  });
  assert.deepEqual(checked.sort(), ['Société Beta SARL', 'Société Exemple SAS']);
  assert.ok(result.issues.some((issue) => issue.avocat === 'Société Beta SARL : le BODACC signale procédure collective : redressement judiciaire ouvert le 02/05/2025.'));
  assert.ok(result.issues.some((issue) => issue.avocat?.startsWith('Société Exemple SAS : SIREN non renseigné')));
  assert.equal(result.log.find((entry) => entry.key === 'bodacc:Société Beta SARL')?.status, 'alerte');
});

const CESSION_SOURCES: Record<string, SourceInfo> = {
  'pieces/02_cession.md': { kind: 'piece', title: 'Cession de titres (fictive)', text: 'Article 1. Les délais se calculent de date à date. Article 7. La garantie est due deux ans à compter de la réalisation. Elle ne couvre pas un préjudice inférieur ou égal à 3.000 euros.' },
  'pieces/03_realisation.md': { kind: 'piece', title: 'Procès-verbal de réalisation (fictif)', text: 'Réalisation intervenue le 15/06/2022.' },
  'pieces/08_notification.md': { kind: 'piece', title: 'Notification de réclamation (fictive)', text: 'Notification du 10/02/2024 : dommage de 45.000 euros.' },
};
const CESSION_CODE = `{
  questions: [{ question: \`La réduction de prix est-elle due à Société Exemple SAS ?\`, reponse: 'réduction_due' }],
  valeurs: {
    date_de_réalisation: { valeur: '2022-06-15', preuve: [{ piece: 'pieces/03_realisation.md', citation: \`intervenue le 15/06/2022\` }] },
    date_de_notification: { valeur: '2024-02-10', preuve: [{ piece: 'pieces/08_notification.md', citation: \`Notification du 10/02/2024\` }] },
    montant_du_dommage: { valeur: 45000, preuve: [{ piece: 'pieces/08_notification.md', citation: \`dommage de 45.000 euros\` }] },
  },
  réduction_due: {
    si: [
      { condition: 'notification_dans_la_garantie', delai: { de: 'date_de_réalisation', a: 'date_de_notification', au_plus: { ans: 2 } },
        selon: [{ source: 'pieces/02_cession.md', citation: \`deux ans à compter de la réalisation\`, vigueur: { debut: '2022-06-15', fin: null } }],
        decompte: 'décompte_de_la_garantie' },
      { condition: 'dommage_au_dessus_du_seuil', montant: { valeur: 'montant_du_dommage', plus_de: 3000 },
        selon: [{ source: 'pieces/02_cession.md', citation: \`inférieur ou égal à 3.000 euros\`, vigueur: { debut: '2022-06-15', fin: null } }] },
    ],
  },
  décompte_de_la_garantie: {
    si: [{ condition: 'délai_de_date_à_date', selon: [{ source: 'pieces/02_cession.md', citation: \`Les délais se calculent de date à date\`, vigueur: { debut: '2022-06-15', fin: null } }],
      preuve: [{ piece: 'pieces/02_cession.md', citation: \`Les délais se calculent de date à date\` }] }],
  },
  essais: [
    { nom: \`notification le jour de l’échéance\`, faits: { délai_de_date_à_date: vrai, date_de_réalisation: '2022-06-15', date_de_notification: '2024-06-15', montant_du_dommage: 45000 }, attendu: { réduction_due: vrai } },
    { nom: \`notification tardive\`, faits: { délai_de_date_à_date: vrai, date_de_réalisation: '2022-06-15', date_de_notification: '2024-06-17', montant_du_dommage: 45000 }, attendu: { réduction_due: faux } },
    { nom: \`dommage égal au seuil\`, faits: { délai_de_date_à_date: vrai, date_de_réalisation: '2022-06-15', date_de_notification: '2023-09-10', montant_du_dommage: 3000 }, attendu: { réduction_due: faux } },
  ],
}`;
const cession = (code: string) => verifyReasoning({
  code, cwd: '/dossier-fictif', connectors: connectors(CESSION_SOURCES), reliability: new Map(), nature: () => null, persons: [], dismissed: new Set(),
});

test('un délai et un montant se calculent à partir des valeurs prouvées, et les essais les rejouent', async () => {
  const result = await cession(CESSION_CODE);
  assert.deepEqual(texts(result, 'erreur'), []);
  assert.equal(at(result.annotated, 'questions[0].statut'), 'acquis');
  assert.deepEqual(at(result.annotated, 'réduction_due.si[0].calcul'), { depart: '2022-06-15', echeance: '2024-06-15', date_retenue: '2024-02-10' });
  assert.deepEqual(at(result.annotated, 'réduction_due.si[1].calcul'), { montant: 45000, seuil: 3000 });
  assert.equal(at(result.annotated, 'valeurs.montant_du_dommage.statut'), 'acquis');
  assert.equal(at(result.annotated, 'bilan.essais'), '3/3');
  assert.match(result.log.find((entry) => entry.key === 'fait:notification_dans_la_garantie')!.text, /au plus 2 ans à compter du 15\/06\/2022 : échéance au 15\/06\/2024, date retenue 10\/02\/2024 → oui/);
  assert.doesNotMatch(texts(result, 'manque').join('\n'), /décompte/);
});

test('un délai sans décompte est un manque, sans que le système choisisse la règle ; le décompte est un sous-raisonnement qui conditionne le délai', async () => {
  const result = await cession(CESSION_CODE.replace(/\n {8}decompte: '[^']*' \},/, ' },').replace(/\n  décompte_de_la_garantie: \{[\s\S]*?\n  \},/, ''));
  assert.deepEqual(texts(result, 'erreur'), []);
  const issue = result.issues.find((entry) => entry.path === 'réduction_due.si[0].decompte')!;
  assert.equal(issue.kind, 'manque');
  assert.equal(issue.avocat, 'Notification dans la garantie : la règle sur laquelle se fonde le calcul du délai n’est pas mentionnée.');
  assert.ok(at(result.annotated, 'réduction_due.si[0].manques').some((text: string) => text.startsWith('délai sans décompte : ajoute decompte: \'décompte_de_notification_dans_la_garantie\'')));
  assert.equal(at(result.annotated, 'questions[0].statut'), 'acquis');
  const contradicted = await cession(CESSION_CODE.replace("preuve: [{ piece: 'pieces/02_cession.md', citation: `Les délais se calculent de date à date` }] }],", "contredit: [{ piece: 'pieces/02_cession.md', citation: `Les délais se calculent de date à date` }] }],"));
  assert.equal(at(contradicted.annotated, 'décompte_de_la_garantie.statut'), 'exclu');
  assert.equal(at(contradicted.annotated, 'réduction_due.si[0].statut'), 'exclu');
});

test('une valeur sans pièce laisse le calcul en suspens et devient décisive ; un délai sans date retenue est une erreur', async () => {
  const unproven = await cession(CESSION_CODE.replace("date_de_notification: { valeur: '2024-02-10', preuve: [{ piece: 'pieces/08_notification.md', citation: `Notification du 10/02/2024` }] },", "date_de_notification: { valeur: '2024-02-10' },"));
  assert.equal(at(unproven.annotated, 'questions[0].statut'), 'à établir');
  assert.deepEqual(at(unproven.annotated, 'questions[0].decisifs'), ['notification_dans_la_garantie']);
  assert.match(texts(unproven, 'manque').join('\n'), /notification_dans_la_garantie décide de la réponse : renseigne date_de_notification dans valeurs, avec sa preuve/);
  assert.match(texts(await cession(CESSION_CODE.replace(", a: 'date_de_notification'", '')), 'erreur').join('\n'), /réduction_due\.si\[0\]\.delai : delai : \{ de: date_de_départ, a: date_retenue,/);
});

test('les durées s’ajoutent au calendrier : fin de mois, année bissextile, jours ouvrés', () => {
  assert.equal(addDuration('2023-01-31', { unite: 'mois', nombre: 1 }), '2023-02-28');
  assert.equal(addDuration('2024-02-29', { unite: 'ans', nombre: 1 }), '2025-02-28');
  assert.equal(addDuration('2025-05-09', { unite: 'jours_ouvres', nombre: 1 }), '2025-05-12');
  assert.equal(addDuration('2025-05-09', { unite: 'jours', nombre: 30 }), '2025-06-08');
});

test('un délai ou un montant mal écrit, prouvé sur la condition ou appliqué à une valeur du mauvais type est une erreur', async () => {
  const errors = texts(await cession(CESSION_CODE
    .replace('au_plus: { ans: 2 }', 'au_plus: { semaines: 2 }')
    .replace("montant: { valeur: 'montant_du_dommage', plus_de: 3000 },", "montant: { valeur: 'date_de_réalisation', plus_de: 3000 }, preuve: [{ piece: 'pieces/08_notification.md', citation: `45.000 euros` }],")), 'erreur').join('\n');
  assert.match(errors, /réduction_due\.si\[0\]\.delai : delai : \{ de: date_de_départ/);
  assert.match(errors, /un délai ou un montant se calcule : sa preuve se place dans valeurs/);
  assert.match(errors, /valeurs\.date_de_réalisation : date_de_réalisation sert à dommage_au_dessus_du_seuil : un nombre attendu/);
});

test('le raisonnement se qualifie contractuel ou contentieux ; la qualification appelle la vérification de la validité ou de la prescription', async () => {
  assert.match(texts(await verify(EXAMPLE_CODE), 'manque').join('\n'), /qualification : raisonnement non qualifié/);
  const contractual = texts(await verify(EXAMPLE_CODE.replace('{\n  questions:', "{\n  qualification: 'contractuel',\n  questions:")), 'manque').join('\n');
  assert.match(contractual, /questions\[0\] : contractuel : vérifier la validité : ajoute validite: 'validité_de_…' sur la question/);
  assert.doesNotMatch(contractual, /non qualifié|prescription/);
  const litigation = texts(await verify(EXAMPLE_CODE.replace('{\n  questions:', "{\n  qualification: 'contentieux',\n  questions:")), 'manque').join('\n');
  assert.match(litigation, /questions\[0\] : contentieux : vérifier la prescription : ajoute prescription:/);
  assert.doesNotMatch(litigation, /validité/);
  const valid = await verify(EXAMPLE_CODE.replace('{\n  questions:', "{\n  qualification: 'contractuel',\n  questions:").replace("reponse: 'pénalité_encourue',", "reponse: 'pénalité_encourue', validite: 'validité_du_contrat',").replace('\n  essais:', "\n  validité_du_contrat: { sauf: [{ condition: 'vice_du_consentement', selon: [{ source: 'pieces/01_contrat.md', citation: `En cas de retard de livraison` }], preuve: [{ piece: 'pieces/06_mise_en_demeure.md', citation: `vous met en demeure` }] }] },\n  essais:"));
  assert.doesNotMatch(texts(valid, 'manque').join('\n'), /vérifier la validité/);
  assert.deepEqual(texts(valid, 'erreur'), []);
  assert.equal(at(valid.annotated, 'validité_du_contrat.statut'), 'exclu');
  assert.equal(at(valid.annotated, 'questions[0].statut'), 'exclu');
  assert.match(texts(await verify(EXAMPLE_CODE.replace('{\n  questions:', "{\n  qualification: 'pénal',\n  questions:")), 'erreur').join('\n'), /qualification : qualification : 'contractuel' ou 'contentieux'/);
});

test('les contrôles portent un nom préfixé, désigné par leur emplacement ; le fichier revient dans l’ordre canonique', async () => {
  const errors = texts(await verify(EXAMPLE_CODE.replaceAll("applicabilite: 'applicabilité_de_l_article_1231_5'", "applicabilite: 'article_1231_5_applicable'")), 'erreur').join('\n');
  assert.match(errors, /applicabilite : le nom commence par applicabilité_ \(ex\. applicabilité_article_1231_5_applicable\)/);
  assert.match(errors, /applicabilité_de_l_article_1231_5 : applicabilité_de_l_article_1231_5 est un contrôle : désigne-le par applicabilite/);
  assert.match(texts(await verify(EXAMPLE_CODE.replace("au: 'date_de_conclusion_du_contrat' }, applicabilite", "au: 'date_de_conclusion_du_contrat' }, applicabilite: 'applicabilité_inconnue', autre")), 'erreur').join('\n'), /terme applicabilité_inconnue non défini/);
  const result = await verify(EXAMPLE_CODE);
  const keys = Object.keys(result.annotated as object);
  assert.deepEqual(keys.slice(0, 3), ['bilan', 'questions', 'pénalité_encourue']);
  assert.ok(keys.indexOf('applicabilité_de_l_article_1231_5') > keys.indexOf('grève'));
  assert.deepEqual(keys.slice(-2), ['valeurs', 'essais']);
  assert.deepEqual(Object.keys(at(result.annotated, 'pénalité_encourue.si[0].selon[0]')).slice(0, 5), ['source', 'citation', 'vigueur', 'applicabilite', 'titre']);
  assert.equal(at(result.annotated, 'bilan.controles'), '1/1 établis');
});

test('en contrat, les faits sont des hypothèses : pas de manque de preuve, mais chaque question a son essai, et les essais reprennent les faits établis', async () => {
  const contractual = await verify(EXAMPLE_CODE.replace('{\n  questions:', "{\n  qualification: 'contractuel',\n  questions:"));
  const manques = texts(contractual, 'manque').join('\n');
  assert.doesNotMatch(manques, /décide de la réponse/);
  assert.ok(at(contractual.annotated, 'questions[0].decisifs').length);
  assert.doesNotMatch(manques, /question sans essai/);
  assert.match(texts(await verify(EXAMPLE_CODE.replace('{\n  questions:', "{\n  qualification: 'contractuel',\n  questions:").replace(/\n  essais: \[[\s\S]*?\n  \],/, '')), 'manque').join('\n'), /questions\[0\] : question sans essai : ajoute dans essais un cas dont attendu porte sur pénalité_encourue/);
  assert.match(texts(await verify(EXAMPLE_CODE), 'manque').join('\n'), /décide de la réponse/);
  const inherited = await verify(EXAMPLE_CODE.replace('faits: { retard_de_livraison: vrai, mise_en_demeure: vrai, grève_nationale: vrai }', 'faits: { grève_nationale: vrai }'));
  assert.equal(at(inherited.annotated, 'bilan.essais'), '1/1');
  assert.match(texts(await verify(EXAMPLE_CODE.replace("reponse: 'pénalité_encourue',", "reponse: 'validité_du_contrat', validite: 'validité_du_contrat',")), 'erreur').join('\n'), /questions\[0\]\.validite : validite : la question porte déjà sur ce contrôle/);
});

test('une clause n’a pas à porter sa vigueur ; le fichier est réécrit dans l’ordre canonique', async () => {
  assert.doesNotMatch(texts(await verify(EXAMPLE_CODE.replaceAll(", vigueur: { debut: '2024-01-15', fin: null }", '')), 'manque').join('\n'), /vigueur non renseignée/);
  const shuffled = EXAMPLE_CODE.replace('{\n  questions:', '{\n  essais: [],\n  questions:');
  const result = await verify(shuffled);
  assert.ok(result.code.indexOf('questions:') < result.code.indexOf('pénalité_encourue:'));
  assert.ok(result.code.indexOf('pénalité_encourue:') < result.code.indexOf('applicabilité_de_l_article_1231_5:'));
  assert.ok(result.code.lastIndexOf('essais:') > result.code.indexOf('valeurs:'));
  assert.deepEqual(texts(await verify(result.code), 'erreur'), texts(result, 'erreur'));
});
