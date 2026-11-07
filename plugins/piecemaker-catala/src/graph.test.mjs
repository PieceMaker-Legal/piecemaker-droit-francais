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

const citations = [
  { origin: module.chemin, target: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032041472', quote: 'Le créancier peut, à ses risques et périls, résoudre le contrat par voie de notification.', status: 'passed', title: 'Code civil, article 1226', id: 'LEGIARTI000032041472' },
  { origin: module.chemin, target: '../../../pieces/lettre-jean-dupont.md', quote: 'Société Exemple SAS est mise en demeure de livrer.', status: 'failed' },
];

test('turns the trace into facts and rules written for a lawyer', () => {
  const model = reasoning(dot, [module], citations);
  assert.deepEqual(model.steps.map((step) => [step.kind, step.title, step.value, step.answer]), [
    ['fact', 'Mise en demeure', 'Vrai', false],
    ['rule', 'Résolution possible', 'Vrai', true],
  ]);
  const [fact, rule] = model.steps;
  assert.deepEqual(rule.parents, [fact.id]);
  assert.deepEqual(rule.sources.map((source) => [source.label, source.kind, source.title]), [['Article 1226', 'article', 'Code civil, article 1226']]);
  assert.match(rule.sources[0].quote, /résoudre le contrat/);
  assert.deepEqual(fact.sources.map((source) => [source.label, source.kind, source.status]), [['Pièce 2, lettre', 'piece', 'failed']]);
  assert.deepEqual(model.others.map((source) => source.label), ['Article 1104']);
  assert.equal(human('date_de_la_mise_en_demeure = false'), 'date de la mise en demeure = Faux');
  assert.equal(human('inexecution_grave et delai_respecte'), 'inexécution grave et délai respecté');
  assert.equal(human('resolution_possible'), 'résolution possible');
});

test('writes the rule, then its projection, then its justification', () => {
  const model = reasoning(dot, [module], citations);
  const document = new JSDOM(reasoningText(model)).window.document;
  const card = document.querySelector('[data-card]');
  assert.equal(card.querySelector('.pmc-kind').textContent, 'Conclusion');
  assert.equal(card.querySelector('h3').textContent, 'Résolution possible');
  assert.match(card.querySelector('[data-part="rule"]').textContent, /Article 1226\s*Code civil/);
  assert.match(card.querySelector('[data-part="rule"]').textContent, /Le créancier peut, à ses risques et périls/);
  assert.match(card.querySelector('[data-part="rule"]').textContent, /Mise en demeure/);
  assert.equal(card.querySelector('[data-part="projection"] .pmc-value').textContent, 'Vrai');
  assert.match(card.querySelector('[data-part="justification"]').textContent, /Mise en demeure Établi/);
  assert.match(card.querySelector('[data-part="justification"]').textContent, /Pièce 2, lettre/);
  const link = card.querySelector('[data-part="rule"] [data-open-reference]');
  assert.equal(link.getAttribute('data-target'), 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032041472');
  assert.equal(link.getAttribute('data-origin'), module.chemin);
  assert.equal(link.getAttribute('data-id'), 'LEGIARTI000032041472');
  assert.match(document.body.textContent, /Autres sources citées/);
  assert.doesNotMatch(document.body.textContent, /Étape|Niveau|catala|test_resolution|LEGIARTI000032041472/);
  const fact = new JSDOM(reasoningCard(model.steps[0], model)).window.document;
  assert.match(fact.body.textContent, /Citation non retrouvée dans la source/);
  assert.deepEqual(reasoningIssues(model).map((entry) => [entry.id, entry.title]), [[model.steps[0].id, 'Pièce 2, lettre']]);
});

test('draws the premises on the left and the conclusion on the right', () => {
  const model = reasoning(dot, [module], citations);
  const document = new JSDOM(reasoningGraph(model)).window.document;
  const nodes = [...document.querySelectorAll('[data-node]')];
  assert.deepEqual(nodes.map((node) => [node.dataset.kind, node.dataset.level]), [['answer', '0'], ['fact', '1']]);
  assert.ok(parseFloat(nodes[0].style.left) > parseFloat(nodes[1].style.left));
  assert.equal(document.querySelectorAll('[data-from][data-to]').length, 1);
  assert.equal(document.querySelector('[data-from]').getAttribute('data-from'), nodes[1].dataset.node);
  assert.match(nodes[0].querySelector('[data-open-reference]').textContent, /Article 1226/);
  assert.equal(nodes[1].querySelector('[data-open-reference]').textContent, 'Pièce 2, lettre');
  assert.match(nodes[1].textContent, /Établi/);
  assert.equal(document.querySelectorAll('.pmc-column').length, 0);
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
    x003 [label=<<table><tr><td>inexecution_grave</td></tr><tr><td>inexécution</td></tr><tr><td>=</td></tr><tr><td>true</td></tr></table>>];
    x004 [label=<<table><tr><td>résolution_possible</td></tr><tr><td>inexécution_grave et non force_majeure</td></tr><tr><td>=</td></tr><tr><td>true</td></tr></table>>];
    subgraph cluster_inputs { x001; x002; }
    x001 -> x003 [style="solid"];
    x003 -> x004 [style="solid"];
    x002 -> x004 [style="solid"];
  }`);
  const document = new JSDOM(reasoningGraph(model)).window.document;
  const nodes = [...document.querySelectorAll('[data-node]')].map((node) => [node.dataset.kind, node.dataset.level, node.querySelector('.pmc-node-title')?.textContent]);
  assert.deepEqual(nodes, [
    ['rule', '0', 'Résolution possible'],
    ['rule', '1', 'Inexécution grave'],
    ['fact', '2', 'Inexécution'],
    ['exception', '1', 'Sauf Force majeure'],
  ]);
  assert.equal(document.querySelectorAll('.is-sauf').length, 1);
  assert.match(document.querySelector('[data-kind="exception"]').textContent, /Sauf Force majeure/);
  assert.match(document.querySelector('[data-kind="exception"]').textContent, /Exception écartée/);
  const card = new JSDOM(reasoningText(model)).window.document.querySelector('[data-card="x004"]');
  assert.match(card.querySelector('[data-part="rule"]').textContent, /Sauf\s*Force majeure/);
  assert.match(card.querySelector('[data-part="projection"]').textContent, /Les conditions sont remplies/);
});

test('shows the exception branch when Catala only traces the applied exception', () => {
  const model = reasoning(`digraph G {
    x009 [label=<<table><tr><td colspan="2">Demo.Resolution</td></tr><tr><td>resolution_possible</td><td>false</td></tr></table>>, URL="https://catala.local/demo.catala_fr#L9", shape=plaintext];
    x010 [label=<<table><tr><td><b>resolution_possible</b></td></tr><tr><td><b>= false</b></td></tr></table>>, URL="https://catala.local/demo.catala_fr#L31", style="filled"];
    x011 [label=<<table><tr><td><b>force_majeure</b></td></tr><tr><td><b>= true</b></td></tr></table>>, URL="https://catala.local/test_demo.catala_fr#L13", style="filled"];
    subgraph cluster_inputs { x011; }
    x010 -> x009 [style="solid"];
    x011 -> x010 [style="dashed", color="#FF7700"];
  }`);
  assert.equal(model.steps.find((step) => step.kind === 'rule').exception, true);
  const document = new JSDOM(reasoningText(model)).window.document;
  const card = document.querySelector('[data-card="x010"]');
  assert.match(card.querySelector('[data-part="rule"]').textContent, /retenue par exception/);
  assert.match(card.querySelector('[data-part="projection"]').textContent, /Faux/);
  assert.match(card.querySelector('[data-part="justification"]').textContent, /Force majeure Établi/);
  const graph = [...new JSDOM(reasoningGraph(model)).window.document.querySelectorAll('[data-node]')].map((node) => [node.getAttribute('data-kind'), node.textContent]);
  assert.deepEqual(graph, [['answer', 'Résolution possibleFaux'], ['exception', 'Sauf Force majeureÉtabli']]);
});
