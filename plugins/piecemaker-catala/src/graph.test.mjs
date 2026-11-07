import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { human, reasoning, reasoningCard, reasoningGraph, reasoningIssues, reasoningText } from './graph.ts';

globalThis.DOMParser = new JSDOM().window.DOMParser;

const module = {
  nom: 'resolution.catala_fr',
  chemin: '/dossiers/exemple/.piecemaker/catala/resolution/resolution.catala_fr',
  contenu: `> Module Resolution

## Article 1226 du code civil

[Article 1226](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032041472)
Citation : « Le créancier peut, à ses risques et périls, résoudre le contrat par voie de notification. »

\`\`\`catala-metadata
déclaration champ d'application RésolutionUnilatérale:
  entrée mise_en_demeure contenu booléen
  résultat résolution_possible contenu booléen
\`\`\`

\`\`\`catala
champ d'application RésolutionUnilatérale:
  définition résolution_possible égal à mise_en_demeure
\`\`\`

## Pièce 2

Concerne : mise_en_demeure

[Pièce 2, lettre](../../../pieces/lettre-jean-dupont.md)
Citation : « Société Exemple SAS est mise en demeure de livrer. »

## Article 1104

[Article 1104](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032040794)
`,
};

const dot = `digraph G {
  x001 [label=<<table><tr><td>mise_en_demeure</td><td>true</td></tr></table>>, URL="https://catala.local/test_resolution.catala_fr#L8", style="filled"];
  x002 [label=<<table><tr><td>résolution_possible</td></tr><tr><td>mise_en_demeure</td></tr><tr><td>=</td></tr><tr><td>true</td></tr></table>>, URL="https://catala.local/resolution.catala_fr#L16", style="filled"];
  x003 [label=<<table><tr><td>Resolution.RésolutionUnilatérale</td></tr><tr><td>résolution_possible</td></tr><tr><td>true</td></tr></table>>, shape=plaintext];
  subgraph cluster_inputs { x001; }
  x001 -> x002 [style="solid"];
  x002 -> x003 [style="solid"];
}`;

const citations = [{ origin: module.chemin, target: '../../../pieces/lettre-jean-dupont.md', quote: 'Société Exemple SAS est mise en demeure de livrer.', status: 'failed' }];

test('turns the trace into facts and rules written for a lawyer', () => {
  const model = reasoning(dot, [module], citations);
  assert.deepEqual(model.steps.map((step) => [step.kind, step.title, step.value, step.answer]), [
    ['fact', 'Mise en demeure', 'Vrai', false],
    ['rule', 'Résolution possible', 'Vrai', true],
  ]);
  const [fact, rule] = model.steps;
  assert.deepEqual(rule.parents, [fact.id]);
  assert.deepEqual(rule.sources.map((source) => [source.label, source.kind]), [['Article 1226', 'article']]);
  assert.match(rule.sources[0].quote, /résoudre le contrat/);
  assert.deepEqual(fact.sources.map((source) => [source.label, source.kind, source.status]), [['Pièce 2, lettre', 'piece', 'failed']]);
  assert.deepEqual(model.others.map((source) => source.label), ['Article 1104']);
  assert.equal(human('date_de_la_mise_en_demeure = false'), 'date de la mise en demeure = Faux');
});

test('writes each rule with its basis, its value and how it applies', () => {
  const model = reasoning(dot, [module], citations);
  const document = new JSDOM(reasoningText(model)).window.document;
  const cards = [...document.querySelectorAll('[data-card]')];
  assert.equal(cards[0].querySelector('.pmc-kind').textContent, 'Question');
  assert.equal(cards[0].querySelector('h3').textContent, 'Résolution possible');
  assert.match(cards[0].querySelector('[data-part="law"]').textContent, /Résolution possible si :\s*Condition Mise en demeure/);
  assert.match(cards[0].querySelector('[data-part="facts"]').textContent, /Fait Mise en demeure Établi/);
  assert.match(cards[0].querySelector('.pmc-result').textContent, /Vrai Toutes les conditions sont remplies\./);
  const link = cards[0].querySelector('[data-open-reference]');
  assert.equal(link.dataset.target, 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032041472');
  assert.equal(link.dataset.origin, module.chemin);
  assert.match(cards[0].querySelector('.pmc-application').textContent, /Mise en demeure/);
  assert.match(document.body.textContent, /Autres sources citées/);
  assert.doesNotMatch(document.body.textContent, /Étape|catala|test_resolution|LEGIARTI000032041472/);
  const fact = new JSDOM(reasoningCard(model.steps[0], model)).window.document;
  assert.match(fact.body.textContent, /Citation non retrouvée dans la source/);
  assert.deepEqual(reasoningIssues(model).map((entry) => [entry.id, entry.title]), [[model.steps[0].id, 'Pièce 2, lettre']]);
});

test('draws the rule, then the law it requires, then the facts', () => {
  const model = reasoning(dot, [module], citations);
  const document = new JSDOM(reasoningGraph(model)).window.document;
  const nodes = [...document.querySelectorAll('[data-node]')];
  assert.deepEqual(nodes.map((node) => [node.dataset.kind, node.dataset.level]), [['answer', '0'], ['law', '1'], ['fact', '2']]);
  assert.ok(parseFloat(nodes[0].style.left) < parseFloat(nodes[1].style.left));
  assert.equal(document.querySelectorAll('[data-from][data-to]').length, 2);
  assert.equal(nodes[0].querySelector('[data-open-reference]').textContent, 'Article 1226');
  assert.equal(nodes[2].querySelector('[data-open-reference]').textContent, 'Pièce 2, lettre');
  assert.match(nodes[1].textContent, /Remplie/);
  assert.equal(reasoningGraph(reasoning('digraph G {}')), '');
});

test('flags a rule without legal basis and escapes trace text', () => {
  const model = reasoning(`digraph G {
    x001 [label=<<table><tr><td>&lt;img src=x onerror=alert(1)&gt;</td></tr><tr><td>=</td></tr><tr><td>false</td></tr></table>>, URL="https://catala.local/autre.catala_fr#L3"];
  }`);
  assert.equal(model.steps[0].issue, 'Aucun article ni aucune décision rattaché à cette règle.');
  const document = new JSDOM(reasoningText(model) + reasoningGraph(model)).window.document;
  assert.equal(document.querySelectorAll('img, script, [onerror]').length, 0);
  assert.throws(() => reasoning('digraph G { x001 [label=<a>]; x002 [label=<b>]; x001 -> x002 [style="solid"]; x002 -> x001 [style="solid"]; }'), /cycle/);
});

test('follows the depth of the Catala rules and separates exceptions', () => {
  const model = reasoning(`digraph G {
    x001 [label=<<table><tr><td>inexécution</td><td>true</td></tr></table>>, style="filled"];
    x002 [label=<<table><tr><td>force_majeure</td><td>false</td></tr></table>>, style="filled"];
    x003 [label=<<table><tr><td>inexécution_grave</td></tr><tr><td>inexécution</td></tr><tr><td>=</td></tr><tr><td>true</td></tr></table>>];
    x004 [label=<<table><tr><td>résolution_possible</td></tr><tr><td>inexécution_grave et non force_majeure</td></tr><tr><td>=</td></tr><tr><td>true</td></tr></table>>];
    subgraph cluster_inputs { x001; x002; }
    x001 -> x003 [style="solid"];
    x003 -> x004 [style="solid"];
    x002 -> x004 [style="solid"];
  }`);
  const document = new JSDOM(reasoningGraph(model)).window.document;
  const nodes = [...document.querySelectorAll('[data-node]')].map((node) => [node.dataset.kind, node.dataset.level, node.querySelector('strong, a')?.textContent]);
  assert.deepEqual(nodes, [
    ['rule', '0', 'Résolution possible'],
    ['law', '1', 'Inexécution grave'],
    ['law', '2', 'Inexécution'],
    ['fact', '3', 'Inexécution'],
    ['exception', '1', 'Force majeure'],
    ['fact', '2', 'Force majeure'],
  ]);
  assert.equal(document.querySelectorAll('.is-sauf').length, 1);
  assert.match(document.querySelector('[data-kind="exception"]').textContent, /Sauf.*Exception écartée/);
  const card = new JSDOM(reasoningText(model)).window.document.querySelector('[data-card="x004"]');
  assert.match(card.querySelector('.pmc-result').textContent, /Toutes les conditions sont remplies/);
});
