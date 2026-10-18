import assert from 'node:assert/strict';
import test from 'node:test';

import type { ReasoningSource, ReasoningValue } from '../../../../shared/piecemaker-reasoning.js';
import { checkTypes, freeVariables, parseCatala, printCatala } from '../catala.js';
import type { Expression } from '../catala.js';
import { evaluateReasoning } from '../evaluate.js';

const piece: ReasoningSource = { id: 'spie0001', kind: 'document', document: 'document:pieces/pv.md', title: 'PV fictif', excerpt: 'Approuvé.', token: '', verified: true, repaired: false };
const sources = new Map([[piece.id, piece]]);

const reprint = (text: string) => {
  const printed = printCatala(parseCatala(text));
  assert.equal(printCatala(parseCatala(printed)), printed);
  return printed;
};
const cited = (text: string) => text.replace(/^(\s+)(?=définition |règle |exception |étiquette )/gm, '$1#[selon = spie0001] ');
const evaluate = (text: string) => {
  const source = cited(text);
  reprint(source);
  const result = evaluateReasoning(parseCatala(source), sources, new Map());
  assert.deepEqual(result.diagnostics, []);
  return result;
};
const valueOf = (text: string, id: string): ReasoningValue => evaluate(text).conditions.find((entry) => entry.id === id)!.value;
const issuesOf = (text: string, id: string) => evaluate(text).conditions.find((entry) => entry.id === id)!.issues.join(' ');
const typeMessages = (text: string) => checkTypes(parseCatala(text));

const structures = `déclaration structure Ligne:
  donnée montant contenu argent
  donnée payee contenu booléen

déclaration énumération Statut:
  -- Ouvert
  -- Clos contenu entier

déclaration Double contenu entier dépendant de x contenu entier égal à x * 2

`;

test('les structures, énumérations et constantes globales s’analysent, se réimpriment et s’évaluent', () => {
  const text = `${structures}déclaration champ d'application Calcul:
  interne ligne contenu Ligne
  interne total contenu argent
  interne statut contenu Statut
  interne doubles contenu liste de entier
  interne ok condition

champ d'application Calcul:
  définition ligne égal à Ligne { -- montant: 150 -- payee: vrai }
  définition total égal à ligne.montant + 50
  définition statut égal à Clos contenu 3
  définition doubles égal à [Double de 2; 3]
  règle ok sous condition ligne.payee conséquence rempli
`;
  assert.match(reprint(text), /déclaration énumération Statut:\n {2}-- Ouvert\n {2}-- Clos contenu entier/);
  assert.deepEqual(valueOf(text, 'Calcul.ligne'), { structure: 'Ligne', champs: { montant: 150, payee: true } });
  assert.equal(valueOf(text, 'Calcul.total'), 200);
  assert.deepEqual(valueOf(text, 'Calcul.statut'), { énumération: 'Statut', cas: 'Clos', contenu: 3 });
  assert.deepEqual(valueOf(text, 'Calcul.doubles'), [4, 3]);
  assert.equal(valueOf(text, 'Calcul.ok'), true);
});

test('les listes, leurs opérations et les filtres s’évaluent sans inconnu', () => {
  const text = `déclaration champ d'application Listes:
  interne nombres contenu liste de entier
  interne compte contenu entier
  interne total contenu entier
  interne max contenu entier
  interne min contenu entier
  interne vide_max contenu entier
  interne existe_sept condition
  interne tous_positifs condition
  interne doubles contenu liste de entier
  interne pairs contenu liste de entier
  interne plus_grand contenu entier
  interne cumul contenu entier
  interne concat contenu liste de entier
  interne contient_sept condition
  interne total_durée contenu durée

champ d'application Listes:
  définition nombres égal à [4; 7; 2]
  définition compte égal à nombre de nombres
  définition total égal à somme entier de nombres
  définition max égal à maximum de nombres
  définition min égal à minimum de nombres
  définition vide_max égal à maximum de [] ou si liste vide alors 0
  définition existe_sept égal à existe x parmi nombres tel que x = 7
  définition tous_positifs égal à pour tout x parmi nombres on a x > 0
  définition doubles égal à transforme chaque x parmi nombres en x * 2
  définition pairs égal à liste de x parmi nombres tel que x > 3
  définition plus_grand égal à contenu de x parmi nombres tel que x est maximum
  définition cumul égal à combine tout x parmi nombres dans acc initialement 0 avec acc + x
  définition concat égal à [1] ++ [2; 3]
  définition contient_sept égal à nombres contient 7
  définition total_durée égal à somme durée de [2 mois; 3 mois]
`;
  assert.equal(valueOf(text, 'Listes.compte'), 3);
  assert.equal(valueOf(text, 'Listes.total'), 13);
  assert.equal(valueOf(text, 'Listes.max'), 7);
  assert.equal(valueOf(text, 'Listes.min'), 2);
  assert.equal(valueOf(text, 'Listes.vide_max'), 0);
  assert.equal(valueOf(text, 'Listes.existe_sept'), true);
  assert.equal(valueOf(text, 'Listes.tous_positifs'), true);
  assert.deepEqual(valueOf(text, 'Listes.doubles'), [8, 14, 4]);
  assert.deepEqual(valueOf(text, 'Listes.pairs'), [4, 7]);
  assert.equal(valueOf(text, 'Listes.plus_grand'), 7);
  assert.equal(valueOf(text, 'Listes.cumul'), 13);
  assert.deepEqual(valueOf(text, 'Listes.concat'), [1, 2, 3]);
  assert.equal(valueOf(text, 'Listes.contient_sept'), true);
  assert.deepEqual(valueOf(text, 'Listes.total_durée'), { ans: 0, mois: 5, jours: 0 });
});

test('une fonction avec arguments, une fonction globale et des entrées de type liste se réimpriment et s’évaluent', () => {
  const text = `déclaration champ d'application Taxe:
  entrée base contenu décimal
  interne taux dépendant de annee contenu entier contenu décimal
  interne base_calc contenu décimal
  résultat montant contenu décimal
  contexte résultat ok condition

champ d'application Taxe:
  définition taux de annee égal à si annee > 2020 alors 0,25 sinon 0,1
  définition base_calc égal à 1000
  définition montant égal à base_calc * taux de 2024
  règle ok conséquence rempli
`;
  assert.equal(valueOf(text, 'Taxe.montant'), 250);
  assert.equal(valueOf(text, 'Taxe.ok'), true);
  const fonction = evaluate(text).conditions.find((entry) => entry.id === 'Taxe.taux')!;
  assert.equal(fonction.value, null);
  assert.equal(fonction.status, 'indéterminée');
  assert.deepEqual(fonction.issues, []);
});

test('les états s’enchaînent : chaque état lit l’état précédent, et la variable prend le dernier état', () => {
  const text = `déclaration champ d'application Procedure:
  interne phase contenu entier état ouverte état cloturee

champ d'application Procedure:
  définition phase état ouverte égal à 1
  définition phase état cloturee égal à phase + 1
`;
  assert.match(reprint(text), /définition phase état ouverte égal à 1\n {2}définition phase état cloturee égal à phase \+ 1/);
  assert.equal(valueOf(text, 'Procedure.phase'), 2);
});

test('un sous-champ reçoit ses entrées de l’appelant, sert ses résultats et s’appelle avec résultat de', () => {
  const text = `déclaration champ d'application Interet:
  entrée capital contenu argent
  résultat total contenu argent

champ d'application Interet:
  définition total égal à capital * 2

déclaration champ d'application Principal:
  partie champ d'application Interet
  interne resultat contenu argent
  interne appel contenu argent

champ d'application Principal:
  définition partie.capital égal à 500
  définition resultat égal à partie.total
  définition appel égal à (résultat de Interet avec { -- capital: 10 }).total
`;
  assert.match(reprint(text), /partie champ Interet/);
  assert.equal(valueOf(text, 'Principal.resultat'), 1000);
  assert.equal(valueOf(text, 'Principal.appel'), 20);
  assert.deepEqual(checkTypes(parseCatala(text)), []);
});

test('une règle sans étiquette peut être corrigée par une exception sans nom', () => {
  const text = (condition: string) => `déclaration champ d'application Regle:
  interne ouverte condition

champ d'application Regle:
  règle ouverte conséquence rempli
  exception règle ouverte sous condition ${condition} conséquence non rempli
`;
  assert.equal(valueOf(text('faux'), 'Regle.ouverte'), true);
  assert.equal(valueOf(text('vrai'), 'Regle.ouverte'), false);
  assert.match(reprint(text('vrai')), /exception règle ouverte sous condition vrai conséquence non rempli/);
});

test('une exception étiquetée ne corrige que la règle de même étiquette', () => {
  const text = (condition: string) => `déclaration champ d'application Regle:
  interne ouverte condition

champ d'application Regle:
  #[libellé = "Principe"]
  étiquette principe règle ouverte conséquence rempli
  exception principe règle ouverte sous condition ${condition} conséquence non rempli
`;
  assert.equal(valueOf(text('vrai'), 'Regle.ouverte'), false);
  assert.equal(valueOf(text('faux'), 'Regle.ouverte'), true);
});

test('une assertion fausse ou inconnue est signalée dans les issues de la question', () => {
  const text = (bound: number) => `déclaration champ d'application Contrainte:
  entrée inconnue contenu entier
  interne n contenu entier
  interne ok condition

champ d'application Contrainte:
  définition n égal à 3
  règle ok conséquence rempli
  #[libellé = "n assez grand"]
  assertion n > ${bound}
`;
  assert.match(reprint(text(5)), /assertion n > 5/);
  const fausse = evaluate(text(5)).questions.find((entry) => entry.scope === 'Contrainte')!;
  assert.match(fausse.issues.join(' '), /Assertion non vérifiée : n assez grand/);
  assert.equal(fausse.valid, false);
  const verifiee = evaluate(text(1)).questions.find((entry) => entry.scope === 'Contrainte')!;
  assert.doesNotMatch(verifiee.issues.join(' '), /Assertion/);
  const inconnue = evaluate(`déclaration champ d'application Inconnu:
  entrée x contenu entier
champ d'application Inconnu:
  assertion x > 0
`).questions.find((entry) => entry.scope === 'Inconnu')!;
  assert.match(inconnue.issues.join(' '), /Assertion à établir : x > 0/);
});

test('la directive d’arrondi des dates décide du quantième quand le mois est plus court', () => {
  const text = (direction: string) => `déclaration champ d'application Delai:
  interne fin contenu date

champ d'application Delai:
  date arrondi ${direction}
  définition fin égal à |2024-01-31| + 1 mois
`;
  assert.equal(valueOf(text('croissant'), 'Delai.fin'), '2024-03-01');
  assert.equal(valueOf(text('décroissant'), 'Delai.fin'), '2024-02-29');
});

test('soit, selon, forme, ou bien, pourcentages, impossible et fonctions intégrées s’analysent et s’évaluent', () => {
  const text = `déclaration énumération Forme:
  -- Carre contenu entier
  -- Rond contenu entier
  -- Vide

déclaration structure Point:
  donnée x contenu entier
  donnée y contenu entier

déclaration champ d'application Expr:
  interne p contenu Point
  interne acces contenu entier
  interne aire contenu entier
  interne soit_val contenu entier
  interne figure contenu Forme
  interne choix contenu entier
  interne bascule condition
  interne test condition
  interne pourcent contenu décimal
  interne ou_bien condition
  interne ann contenu entier
  interne premier contenu date
  interne dernier contenu date
  interne arrondi_val contenu entier
  interne boum contenu entier

champ d'application Expr:
  définition p égal à Point { -- x: 3 -- y: 4 }
  définition acces égal à p.y * 2
  définition aire égal à soit c égal à p.x dans c * p.y
  définition soit_val égal à soit c égal à 2 dans c + 1
  définition figure égal à Carre contenu 2
  définition choix égal à selon figure sous forme -- Carre de c : c -- n'importe quel : 0
  définition bascule égal à figure sous forme Carre de c et c > 1
  définition test égal à figure sous forme Rond
  définition pourcent égal à 30%
  définition ou_bien égal à vrai ou bien faux
  définition ann égal à accès_année de |2024-03-01|
  définition premier égal à premier_jour_du_mois de |2024-03-15|
  définition dernier égal à dernier_jour_du_mois de |2024-02-10|
  définition arrondi_val égal à arrondi de 2,6
  définition boum égal à impossible
`;
  assert.match(reprint(text), /soit c égal à p\.x dans c \* p\.y/);
  assert.match(reprint(text), /figure sous forme Carre de c et c > 1/);
  assert.equal(valueOf(text, 'Expr.acces'), 8);
  assert.equal(valueOf(text, 'Expr.aire'), 12);
  assert.equal(valueOf(text, 'Expr.soit_val'), 3);
  assert.equal(valueOf(text, 'Expr.choix'), 2);
  assert.equal(valueOf(text, 'Expr.bascule'), true);
  assert.equal(valueOf(text, 'Expr.test'), false);
  assert.equal(valueOf(text, 'Expr.pourcent'), 0.3);
  assert.equal(valueOf(text, 'Expr.ou_bien'), true);
  assert.equal(valueOf(text, 'Expr.ann'), 2024);
  assert.equal(valueOf(text, 'Expr.premier'), '2024-03-01');
  assert.equal(valueOf(text, 'Expr.dernier'), '2024-02-29');
  assert.equal(valueOf(text, 'Expr.arrondi_val'), 3);
  assert.equal(valueOf(text, 'Expr.boum'), null);
  assert.match(issuesOf(text, 'Expr.boum'), /Cas impossible atteint/);
});

test('les faits de dossier peuvent être des listes ou des structures, et une condition les interroge', () => {
  const text = `déclaration structure Point:
  donnée x contenu entier

déclaration champ d'application Lot:
  entrée tailles contenu liste de entier
  entrée origine contenu Point
  interne grand condition

champ d'application Lot:
  règle grand sous condition existe t parmi tailles tel que t > 10 conséquence rempli

déclaration champ d'application Dossier:
  lot champ Lot

champ d'application Dossier:
  #[selon = spie0001] #[force = acte_sous_seing_privé]
  définition lot.tailles égal à [4; 12]
  #[selon = spie0001] #[force = acte_sous_seing_privé]
  définition lot.origine égal à Point { -- x: 0 }
`;
  const result = evaluate(text);
  assert.deepEqual(result.facts.find((fact) => fact.id === 'Lot.tailles')!.value, [4, 12]);
  assert.deepEqual(result.facts.find((fact) => fact.id === 'Lot.origine')!.value, { structure: 'Point', champs: { x: 0 } });
  assert.equal(result.facts.find((fact) => fact.id === 'Lot.tailles')!.status, 'établi');
  assert.equal(valueOf(text, 'Lot.grand'), true);
});

test('le vérificateur de types écrit des messages français précis et actionnables', () => {
  const messages = typeMessages(`déclaration champ d'application Q1:
  entrée versement contenu argent
  interne ok condition
  interne compte contenu entier
  interne choix contenu entier
  interne doubles contenu liste de entier

champ d'application Q1:
  règle ok sous condition versement et vrai conséquence rempli
  définition compte égal à vrai
  définition choix égal à inconnu + 1
  définition doubles égal à [1; vrai]
`);
  assert.ok(messages.includes('Q1.ok : « et » attend des booléens, reçu argent.'), messages.join('\n'));
  assert.ok(messages.some((text) => text.startsWith('Q1.compte : valeur de type booléen donnée à « compte »')), messages.join('\n'));
  assert.ok(messages.some((text) => text.includes('« inconnu » n\'est pas déclaré')), messages.join('\n'));
  assert.ok(messages.some((text) => text.includes('Éléments de liste de types différents : nombre et booléen')), messages.join('\n'));
});

test('le vérificateur signale les cas non couverts, les champs absents et les arités fausses', () => {
  const messages = typeMessages(`${structures}déclaration champ d'application Verif:
  interne statut contenu Statut
  interne ligne contenu Ligne
  interne f contenu entier dépendant de x contenu entier
  interne r contenu entier

champ d'application Verif:
  définition statut égal à Clos contenu 3
  définition ligne égal à Ligne { -- montant: 1 -- inconnu: 2 }
  définition r égal à selon statut sous forme -- Clos de c : c
  définition r égal à f de (1, 2)
`);
  assert.ok(messages.some((text) => text.includes('Champs manquants dans Ligne : payee')), messages.join('\n'));
  assert.ok(messages.some((text) => text.includes('Champ « inconnu » absent de la structure Ligne')), messages.join('\n'));
  assert.ok(messages.some((text) => text.includes('« selon » : cas non couverts Ouvert')), messages.join('\n'));
});

test('freeVariables renvoie les variables libres, sans les variables liées ni les noms de cas', () => {
  const program = parseCatala(`déclaration énumération E:
  -- Cas
déclaration champ d'application A:
  interne y condition
champ d'application A:
  règle y sous condition soit c égal à a dans c et (Cas = b) et existe d parmi l tel que d = e.f conséquence rempli
`);
  const condition = program.bodies[0].rules[0].condition as Expression;
  assert.deepEqual([...freeVariables(condition, ['Cas'])].sort(), ['a', 'b', 'e.f', 'l']);
  assert.deepEqual([...freeVariables(condition, ['a', 'Cas'])].sort(), ['b', 'e.f', 'l']);
});

test('un élément de contexte garde sa valeur par défaut, remplacée par le fait établi au dossier', () => {
  const scope = `déclaration champ d'application Contexte:
  contexte taux contenu entier
  interne double contenu entier

champ d'application Contexte:
  définition taux égal à 5
  définition double égal à taux * 2
`;
  assert.equal(valueOf(scope, 'Contexte.double'), 10);
  const dossier = `${scope}
déclaration champ d'application Dossier:
  ctx champ Contexte

champ d'application Dossier:
  #[selon = spie0001] #[force = acte_sous_seing_privé]
  définition ctx.taux égal à 9
`;
  assert.equal(valueOf(dossier, 'Contexte.double'), 18);
  assert.equal(valueOf(dossier, 'Contexte.taux'), 9);
});
