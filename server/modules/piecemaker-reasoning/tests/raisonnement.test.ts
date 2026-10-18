import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';

import type { ReasoningSource } from '../../../../shared/piecemaker-reasoning.js';
import { parseCatala, printCatala } from '../catala.js';
import { evaluateReasoning } from '../evaluate.js';
import { createReasoningService, reasoningExample } from '../program.js';
import type { ReasoningConnectors } from '../commands.js';

function fixture(t: test.TestContext, folder = '/dossier-fictif', links?: ReasoningConnectors) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE projects(project_id TEXT PRIMARY KEY, project_path TEXT);');
  db.prepare('INSERT INTO projects VALUES(?,?)').run('example', folder);
  const service = createReasoningService(() => db, links);
  t.after(() => db.close());
  return { db, service };
}

const article: ReasoningSource = { id: 'sart0001', kind: 'article', document: 'article:LEGIARTI000000000001', title: 'Code fictif, article 1', excerpt: 'Texte fictif.', token: '', verified: true, repaired: false, validity: { from: '2020-01-01', to: null } };
const decision: ReasoningSource = { id: 'sjur0001', kind: 'case', document: 'case:JURITEXT000000000001', title: 'Cass. fictive', excerpt: 'Motif fictif.', token: '', verified: true, repaired: false, history: { status: 'non remise en cause', lines: [] } };
const doctrine: ReasoningSource = { id: 'sdoc0001', kind: 'document', document: 'document:doctrine/note.md', title: 'Note fictive', excerpt: 'Opinion fictive.', token: '', verified: true, repaired: false };
const piece: ReasoningSource = { id: 'spie0001', kind: 'document', document: 'document:pieces/pv.md', title: 'PV fictif', excerpt: 'Approuvé.', token: '', verified: true, repaired: false };

const code = (dossier: string, ruleSources = 'sart0001') => `#[question = "Le versement est-il dû ?"]
#[date_de_référence = date_acte]
déclaration champ d'application Q:
  entrée date_acte contenu date
  entrée approuve contenu booléen
  interne approbation condition
  résultat du condition
champ d'application Q:
  #[libellé = "Approbation"] #[selon = ${ruleSources}]
  règle approbation sous condition approuve conséquence rempli
  #[selon = sart0001]
  règle du sous condition approbation conséquence rempli
déclaration champ d'application Dossier:
  q champ Q
champ d'application Dossier:
${dossier}`;

const facts = `  #[selon = spie0001] #[force = acte_sous_seing_privé]
  définition q.date_acte égal à |2024-03-01|
  #[selon = spie0001] #[force = acte_sous_seing_privé] #[appréciation = "PV signé"]
  définition q.approuve égal à vrai
`;

const run = (text: string, sources: ReasoningSource[] = [article, decision, doctrine, piece]) => evaluateReasoning(parseCatala(text), new Map(sources.map((source) => [source.id, source])), new Map());

test('le code Catala se réimprime à l’identique après analyse', () => {
  const printed = printCatala(parseCatala(code(facts)));
  assert.equal(printCatala(parseCatala(printed)), printed);
  assert.match(printed, /règle approbation sous condition approuve conséquence rempli/);
  const expression = printCatala(parseCatala("déclaration champ d'application A:\n  entrée x contenu entier\n  interne y contenu booléen\nchamp d'application A:\n  définition y égal à non (x > 2 et x < 5) ou x = 1\n"));
  assert.match(expression, /définition y égal à non \(x > 2 et x < 5\) ou x = 1/);
});

test('une question complète, en vigueur et prouvée par pièces, est remplie', () => {
  const result = run(code(facts));
  const question = result.questions[0];
  assert.equal(question.valid, true, question.issues.join(' '));
  assert.equal(question.status, 'remplie');
  assert.deepEqual(question.vigueur, [{ source: 'sart0001', date: '2024-03-01', inForce: true }]);
  assert.equal(result.conditions.find((condition) => condition.id === 'Q.approbation')!.strength, 'loi');
  assert.equal(result.facts.find((fact) => fact.id === 'Q.approuve')!.status, 'établi');
});

test('un article non en vigueur à la date de référence rend la condition non remplie', () => {
  const result = run(code(facts.replace('2024-03-01', '2019-06-01')));
  const condition = result.conditions.find((entry) => entry.id === 'Q.approbation')!;
  assert.equal(condition.status, 'non remplie');
  assert.match(condition.issues.join(' '), /non en vigueur au 2019-06-01/);
});

test('un fait sans pièce reste non établi et rend la question indéterminée', () => {
  const result = run(code(facts.split('\n').slice(0, 2).join('\n')));
  const fact = result.facts.find((entry) => entry.id === 'Q.approuve')!;
  assert.equal(fact.status, 'non établi');
  assert.match(fact.issues.join(' '), /Pièce à rechercher/);
  assert.equal(result.questions[0].status, 'indéterminée');
});

test('une pièce sans valeur probante ou un extrait introuvable n’établit pas le fait', () => {
  assert.equal(run(code(facts.replace('#[force = acte_sous_seing_privé] #[appréciation', '#[force = sans_valeur] #[appréciation'))).facts.find((fact) => fact.id === 'Q.approuve')!.status, 'non établi');
  const unverified = run(code(facts), [article, { ...piece, verified: false }]).facts.find((fact) => fact.id === 'Q.approuve')!;
  assert.equal(unverified.status, 'non établi');
  assert.match(unverified.issues.join(' '), /Extrait introuvable/);
});

test('une décision remise en cause ne fonde plus la condition ; la doctrine seule est signalée', () => {
  const blocked = run(code(facts, 'sjur0001'), [article, { ...decision, history: { status: 'remise en cause', lines: ['Recours fictif'] } }, piece]);
  assert.equal(blocked.conditions.find((entry) => entry.id === 'Q.approbation')!.status, 'bloquée');
  assert.equal(blocked.questions[0].status, 'bloquée');
  const weak = run(code(facts, 'sdoc0001')).conditions.find((entry) => entry.id === 'Q.approbation')!;
  assert.equal(weak.strength, 'doctrine');
  assert.match(weak.issues.join(' '), /seule doctrine/);
  assert.equal(run(code(facts, 'sjur0001, sdoc0001')).conditions.find((entry) => entry.id === 'Q.approbation')!.strength, 'jurisprudence');
});

test('une question sans date de référence ni condition fondée est incomplète', () => {
  const result = run("#[question = \"Q ?\"]\ndéclaration champ d'application Q:\n  entrée a contenu booléen\n  résultat r condition\nchamp d'application Q:\n  règle r sous condition a conséquence rempli\n");
  assert.equal(result.questions[0].valid, false);
  assert.match(result.questions[0].issues.join(' '), /Date de référence/);
  assert.match(result.questions[0].issues.join(' '), /Au moins une condition fondée/);
});

test('une exception applicable l’emporte sur la règle de base', () => {
  const text = code(facts).replace('  #[selon = sart0001]\n  règle du', '  #[selon = sart0001]\n  exception base règle du sous condition date_acte < |2025-01-01| conséquence non rempli\n  #[selon = sart0001]\n  étiquette base règle du');
  assert.equal(run(text).questions[0].status, 'non remplie');
  assert.equal(run(text.replace('2024-03-01', '2025-03-01')).questions[0].status, 'remplie');
});

test('les dates et durées se calculent au même quantième', () => {
  const text = "#[date_de_référence = d]\ndéclaration champ d'application A:\n  entrée d contenu date\n  interne fin contenu date\n  interne ok condition\nchamp d'application A:\n  #[selon = sart0001]\n  définition fin égal à d + 1 mois\n  #[selon = sart0001]\n  règle ok sous condition fin = |2024-02-29| conséquence rempli\ndéclaration champ d'application Dossier:\n  a champ A\nchamp d'application Dossier:\n  #[selon = spie0001] #[force = indice]\n  définition a.d égal à |2024-01-31|\n";
  assert.equal(run(text).conditions.find((entry) => entry.id === 'A.ok')!.value, true);
});

test('l’objectif ordonne les voies, désigne les moyens adverses et répartit la charge de la preuve', () => {
  const text = code(facts)
    .replace('#[date_de_référence = date_acte]', '#[objectif = rempli]\n#[date_de_référence = date_acte]')
    .replace('  entrée approuve contenu booléen', '  entrée approuve contenu booléen\n  entrée tacite contenu booléen\n  entrée revocation contenu booléen')
    .replace('  #[selon = sart0001]\n  règle du sous condition approbation conséquence rempli', '  #[libellé = "Approbation expresse"] #[selon = sart0001]\n  étiquette base règle du sous condition approbation conséquence rempli\n  #[libellé = "Approbation tacite"] #[selon = sdoc0001]\n  règle du sous condition tacite conséquence rempli\n  #[libellé = "Révocation pour faute"] #[selon = sjur0001]\n  exception base règle du sous condition revocation conséquence non rempli');
  const question = run(text).questions[0];
  assert.equal(question.objective, true);
  assert.equal(question.objectiveStatus, 'à établir');
  assert.deepEqual(question.voies.map((voie) => [voie.label, voie.favorable, voie.status, voie.strength]), [
    ['Approbation expresse', true, 'ouverte', 'loi'],
    ['Approbation tacite', true, 'à établir', 'doctrine'],
    ['Révocation pour faute', false, 'à établir', 'jurisprudence'],
  ]);
  assert.deepEqual(question.voies[1].toProve, ['Q.tacite']);
  const result = run(text);
  assert.equal(result.facts.find((fact) => fact.id === 'Q.tacite')!.burden, 'nous');
  assert.equal(result.facts.find((fact) => fact.id === 'Q.revocation')!.burden, 'adversaire');
  const won = run(text.replace('  définition q.approuve égal à vrai', '  définition q.approuve égal à vrai\n  #[selon = spie0001] #[force = indice]\n  définition q.revocation égal à faux'));
  assert.equal(won.questions[0].objectiveStatus, 'atteint');
  assert.match(won.questions[0].voies[2].weaknesses.join(' '), /revocation : simple indice/);
});

const connectors = (overrides: Partial<ReasoningConnectors> = {}): ReasoningConnectors => ({
  async law(id) {
    return id.startsWith('LEGIARTI')
      ? { title: 'Code fictif, article 1', text: 'L’approbation préalable de l’assemblée est requise.', validity: { from: '2020-01-01', to: null } }
      : { title: 'Cass. fictive', text: 'La faute grave prive le dirigeant de son indemnité.', history: { status: 'remise en cause', lines: ['Cassation fictive du 2023-01-01'] } };
  },
  async piece(_cwd, reference) { return reference === 'pieces/pv.md' ? { title: 'PV fictif', text: 'Le 1er mars 2024, l’assemblée approuve l’indemnité.' } : null; },
  match: (text, excerpt) => (text.includes(excerpt) ? excerpt : null),
  async registry({ siren }) { return siren ? { found: true, status: 'Radiée' } : { found: false, status: '' }; },
  async bodacc() { return ['Procédure collective ouverte (fictive).']; },
  ...overrides,
});

const build = async (service: ReturnType<typeof createReasoningService>) => {
  await service.command('/dossier-fictif', { commande: 'question', texte: 'Le versement est-il dû ?', objectif: 'oui', date: 'date_acte' });
  await service.command('/dossier-fictif', { commande: 'condition', question: 'Q1', nom: 'approbation', libelle: 'Approbation préalable', regle: 'approuve', role: 'fondement', source: 'LEGIARTI000000000001', extrait: 'L’approbation préalable de l’assemblée est requise.' });
  await service.command('/dossier-fictif', { commande: 'fait', question: 'Q1', nom: 'date_acte', valeur: '2024-03-01', piece: 'pieces/pv.md', extrait: 'Le 1er mars 2024', force: 'acte_sous_seing_privé' });
  return service.command('/dossier-fictif', { commande: 'fait', question: 'Q1', nom: 'approuve', valeur: 'vrai', piece: 'pieces/pv.md', extrait: 'l’assemblée approuve', force: 'acte_sous_seing_privé', appreciation: 'PV signé' });
};

test('les commandes construisent la théorie pas à pas et disent ce qui reste à faire', async (t) => {
  const { service } = fixture(t, '/dossier-fictif', connectors());
  assert.match(await service.command('/dossier-fictif', { commande: 'etat' }), /Aucune question/);
  assert.match(await service.command('/dossier-fictif', { commande: 'question', texte: 'Le versement est-il dû ?', objectif: 'oui', date: 'date_acte' }), /Q1 enregistrée[\s\S]*date_acte \(date\) : à prouver/);
  await assert.rejects(service.command('/dossier-fictif', { commande: 'condition', question: 'Q1', nom: 'approbation', libelle: 'x', regle: 'approuve et', source: 'LEGIARTI000000000001', extrait: 'x' }), /Règle illisible/);
  const partial = await service.command('/dossier-fictif', { commande: 'condition', question: 'Q1', nom: 'approbation', libelle: 'Approbation préalable', regle: 'approuve', role: 'fondement', source: 'LEGIARTI000000000001', extrait: 'texte inventé' });
  assert.match(partial, /extrait introuvable dans la source/);
  assert.match(partial, /approuve \(booléen\) : à prouver/);
  const done = await build(service);
  assert.match(done, /Réponse : oui · objectif oui : atteint/);
  const snapshot = service.read('/dossier-fictif');
  assert.equal(snapshot.questions[0].status, 'remplie');
  assert.match(snapshot.code, /étiquette base règle reponse sous condition approbation conséquence rempli/);
  assert.match(await service.command('/dossier-fictif', { commande: 'fait', question: 'Q1', nom: 'approuve', valeur: 'vrai', piece: 'pieces/pv.md', extrait: 'phrase absente', force: 'indice' }), /extrait introuvable dans pieces\/pv\.md, fait non établi/);
});

test('un élément validé par l’avocat ne peut plus être modifié par l’agent', async (t) => {
  const { db, service } = fixture(t, '/dossier-fictif', connectors());
  await build(service);
  service.review('/dossier-fictif', 'Q1.approbation', 'validé', 'Conforme au texte');
  await assert.rejects(service.command('/dossier-fictif', { commande: 'condition', question: 'Q1', nom: 'approbation', libelle: 'Autre', regle: 'non approuve', source: 'LEGIARTI000000000001', extrait: 'L’approbation préalable de l’assemblée est requise.' }), /verrouillé par l'avocat/);
  service.appreciate('/dossier-fictif', 'Q1.approuve', { value: false, force: 'indice', appreciation: 'Signature contestable' });
  assert.deepEqual(db.prepare("SELECT status, author, value_json, force FROM pm_reasoning_items WHERE item_id='Q1.approuve'").get(), { status: 'validé', author: 'avocat', value_json: 'false', force: 'indice' });
  assert.equal(service.read('/dossier-fictif').questions[0].status, 'non remplie');
  await service.command('/dossier-fictif', { commande: 'question', question: 'Q1', texte: 'Le versement est-il dû ?', objectif: 'oui', date: 'date_acte' });
  assert.equal(service.read('/dossier-fictif').facts.find((fact) => fact.id === 'Q1.approuve')!.value, false);
  service.review('/dossier-fictif', 'Q1.approuve', null);
  assert.equal((db.prepare("SELECT author FROM pm_reasoning_items WHERE item_id='Q1.approuve'").get() as { author: string }).author, 'ia');
});

test('le test exécute la théorie sur tout le dossier : vigueur, recours, pièces, registre et BODACC', async (t) => {
  const { db, service } = fixture(t, '/dossier-fictif', connectors());
  db.exec(`CREATE TABLE piecemaker_nodes(project_id TEXT, id TEXT, kind TEXT, label TEXT);
    CREATE TABLE piecemaker_links(project_id TEXT, from_node_id TEXT, to_node_id TEXT, relation TEXT);
    CREATE TABLE piecemaker_mappings(project_id TEXT, node_id TEXT, real_value TEXT);
    INSERT INTO piecemaker_nodes VALUES ('example','c1','company','Société Exemple SAS'), ('example','n1','siren','123456789'), ('example','c2','company','ZETABIO');
    INSERT INTO piecemaker_links VALUES ('example','c1','n1','SIREN');`);
  await build(service);
  await service.command('/dossier-fictif', { commande: 'condition', question: 'Q1', nom: 'revocation', libelle: 'Révocation pour faute grave', regle: 'faute', role: 'moyen_adverse', source: 'JURITEXT000000000001', extrait: 'La faute grave prive le dirigeant de son indemnité.' });
  const report = await service.command('/dossier-fictif', { commande: 'tester' });
  assert.match(report, /⚠ Cass\. fictive : Remise en cause par une décision supérieure : Cassation fictive du 2023-01-01\./);
  assert.match(report, /⚠ Société Exemple SAS :\n  - Registre Public : Radiée\.\n  - BODACC : Procédure collective ouverte \(fictive\)\./);
  assert.match(report, /⚠ ZETABIO : Personne morale introuvable au Registre Public\./);
  assert.match(report, /⚠ faute : Pièce à rechercher/);
  assert.match(report, /3 vérification\(s\) conforme\(s\)/);
  assert.match(report, /└─ \[moyen adverse\] revocation : à revoir ⚠ — Révocation pour faute grave\n {5}= faute\n {3}└─ fait faute \(booléen\) : à prouver ✗/);
  const full = await service.command('/dossier-fictif', { commande: 'etat', vue: 'complete' });
  assert.match(full, /règle : approuve/);
  assert.match(full, /PV fictif \(pieces\/pv\.md\)\n.*« [^»]*approuve[^»]* »/);
  assert.match(full, /force : acte_sous_seing_privé/);
  assert.doesNotMatch(full, /Détail des pièces/);
  assert.ok(service.read('/dossier-fictif').test!.findings.length);
  assert.match(service.describe('/dossier-fictif'), /Dernier test .* alerte\(s\)/);
  const streamed: string[] = [];
  const snapshot = await service.test('/dossier-fictif', (entry) => streamed.push(`${entry.step}|${entry.status}|${entry.subject}|${entry.text}`));
  assert.equal(new Set(snapshot.test!.log!.map((entry) => entry.key)).size, snapshot.test!.log!.length);
  assert.ok(snapshot.test!.log!.every((entry) => entry.status !== 'en cours'));
  assert.ok(snapshot.test!.log!.every((entry) => streamed.includes(`${entry.step}|${entry.status}|${entry.subject}|${entry.text}`)));
  assert.match(streamed[0], /^question\|neutre\|/);
  assert.ok(streamed.includes('registre|en cours|ZETABIO|Recherche au Registre Public…'));
  assert.ok(streamed.includes('registre|alerte|ZETABIO|Personne morale introuvable au Registre Public.'));
  assert.ok(streamed.indexOf('registre|en cours|ZETABIO|Recherche au Registre Public…') < streamed.indexOf('registre|alerte|ZETABIO|Personne morale introuvable au Registre Public.'));
  assert.ok(streamed.some((line) => line.startsWith('fait|alerte|faute|')));
  assert.ok(snapshot.test!.log!.some((entry) => entry.step === 'règle' && entry.text.startsWith('Fondement : ')));
  assert.ok(streamed.some((line) => line.startsWith('fait|alerte|faute|Inconnu : pièce à rechercher')));
  assert.ok(streamed.findIndex((line) => line.startsWith('fait|')) < streamed.findIndex((line) => line.startsWith('conclusion|')));
  assert.match(streamed.at(-1)!, /^réponse\|/);
});

test('l’exemple fictif décrit une condition sans fondement et un fait sans pièce', () => {
  const example = reasoningExample();
  assert.equal(example.questions[0].status, 'bloquée');
  assert.match(example.conditions.find((entry) => entry.id === 'Indemnite.approbation_ex_post')!.issues.join(' '), /Fondement manquant/);
  assert.equal(example.facts.find((entry) => entry.id === 'Indemnite.societe_cotee')!.status, 'non établi');
  assert.ok(example.test!.log!.some((entry) => entry.step === 'source' && entry.text === 'Extrait retrouvé dans la pièce.'));
  assert.ok(example.test!.log!.some((entry) => entry.key === 'Indemnite.approbation_ex_ante:conclusion'));
});

test('les commandes exposent tout Catala : types, listes, valeurs calculées, fonctions, exceptions, états, assertions et questions liées', async (t) => {
  const { service } = fixture(t, '/dossier-fictif', connectors());
  const run = (input: Record<string, unknown>) => service.command('/dossier-fictif', input);
  const law = { source: 'LEGIARTI000000000001', extrait: 'L’approbation préalable de l’assemblée est requise.' };
  const proof = { piece: 'pieces/pv.md', extrait: 'l’assemblée approuve', force: 'acte_sous_seing_privé' };
  await build(service);
  assert.match(await run({ commande: 'type', nom: 'Echeance', champs: 'montant contenu argent, payee contenu booléen' }), /Type Echeance enregistré/);
  assert.match(await run({ commande: 'type', nom: 'Rupture', cas: 'Amiable, Judiciaire contenu date' }), /Type Rupture enregistré/);
  await assert.rejects(run({ commande: 'type', nom: 'Mauvais', champs: 'x contenu Inconnu' }), /type inconnu : Inconnu/);
  await run({ commande: 'question', texte: 'La dette est-elle exigible ?', objectif: 'oui', date: 'date_acte' });
  await run({ commande: 'fait', question: 'Q2', nom: 'date_acte', valeur: '2024-03-01', ...proof });
  await run({ commande: 'condition', question: 'Q2', nom: 'majore', libelle: 'Montant majoré', type: 'argent', parametres: 'montant contenu argent', regle: 'montant * 110%', ...law });
  await run({ commande: 'condition', question: 'Q2', nom: 'impaye', libelle: 'Somme des échéances impayées', type: 'argent', regle: 'somme argent de transforme chaque e parmi (liste de e parmi echeances tel que non e.payee) en e.montant', ...law });
  await run({ commande: 'condition', question: 'Q2', nom: 'du', libelle: 'Montant dû', type: 'argent', etat: 'principal', regle: 'impaye', ...law });
  await run({ commande: 'condition', question: 'Q2', nom: 'du', libelle: 'Montant dû majoré', type: 'argent', etat: 'majore', regle: 'majore de du', ...law });
  await run({ commande: 'condition', question: 'Q2', nom: 'exigible', libelle: 'Dette exigible', regle: 'du > 0 €', role: 'fondement', ...law });
  await run({ commande: 'condition', question: 'Q2', nom: 'exigible', libelle: 'Rupture amiable', etiquette: 'amiable', exception_de: 'base', regle: 'rupture sous forme Amiable', consequence: 'non', ...law });
  await run({ commande: 'fait', question: 'Q2', nom: 'echeances', type: 'liste de Echeance', valeur: '[Echeance { -- montant: 1 000 € -- payee: faux }; Echeance { -- montant: 500 € -- payee: vrai }]', ...proof });
  await run({ commande: 'fait', question: 'Q2', nom: 'rupture', type: 'Rupture', valeur: 'Judiciaire contenu |2024-02-01|', ...proof });
  await assert.rejects(run({ commande: 'fait', question: 'Q2', nom: 'montant_declare', type: 'argent', valeur: '2000000', ...proof }), /n’est utilisé par aucune condition/);
  await run({ commande: 'condition', question: 'Q2', nom: 'premiere', libelle: 'La première question est tranchée', regle: 'q1.reponse', ...law });
  await run({ commande: 'condition', question: 'Q2', nom: 'coherence', libelle: 'Le montant dû reste positif', role: 'assertion', regle: 'du >= 0 €' });
  const state = await run({ commande: 'etat', question: 'Q2' });
  assert.match(state, /Réponse : oui · objectif oui : atteint/);
  assert.match(state, /\[fondement\] exigible : remplie ✓ — Dette exigible/);
  assert.match(state, /= \[amiable\] \[exception à base\] rupture sous forme Amiable → non remplie/);
  assert.match(state, /du \[argent\] : 1 100 € ✓/);
  assert.match(state, /majore \(montant contenu argent\) \[argent\] : fonction/);
  assert.match(state, /fait echeances \(liste de Echeance\) : \[Echeance/);
  assert.match(state, /Assertions :\n- coherence — Le montant dû reste positif : du >= 0 €/);
  const snapshot = service.read('/dossier-fictif');
  assert.match(snapshot.code, /déclaration structure Echeance:\n {2}donnée montant contenu argent/);
  assert.match(snapshot.code, /interne du contenu argent état principal état majore/);
  assert.match(snapshot.code, /définition du état majore égal à majore de du/);
  assert.match(snapshot.code, /étiquette amiable exception règle exigible sous condition rupture sous forme Amiable conséquence non rempli/);
  assert.match(snapshot.code, /q1 champ Q1/);
  assert.equal(snapshot.conditions.find((entry) => entry.id === 'Q2.premiere')!.status, 'remplie');
  assert.deepEqual(snapshot.diagnostics.filter((line) => !line.startsWith('Avocat')), []);
  await run({ commande: 'fait', question: 'Q2', nom: 'rupture', type: 'Rupture', valeur: 'Amiable', ...proof });
  assert.match(await run({ commande: 'etat', question: 'Q2' }), /Réponse : non · objectif oui : hors d’atteinte/);
  await run({ commande: 'condition', question: 'Q2', nom: 'coherence', libelle: 'Rien n’est dû', role: 'assertion', regle: 'du = 0 €' });
  assert.match(await run({ commande: 'tester' }), /Assertion non vérifiée/);
  await run({ commande: 'condition', question: 'Q2', nom: 'erreur', libelle: 'Erreur de type', regle: 'du et vrai', ...law });
  assert.match(await run({ commande: 'etat', question: 'Q2' }), /Erreurs du programme :\n- .*« et » attend des booléens/);
});
