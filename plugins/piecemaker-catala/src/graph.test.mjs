import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { human, reasoning, reasoningCard, reasoningGraph, reasoningIssues, reasoningText } from './graph.ts';

globalThis.DOMParser = new JSDOM().window.DOMParser;

test('keeps scenario truth separate from evidence, including a false input', () => {
  for (const [value, expected] of [['true', 'Vrai'], ['false', 'Faux']]) {
    const model = reasoning(`digraph G {
      x001 [label=<<table><tr><td>demande</td><td>${value}</td></tr></table>>];
      subgraph cluster_inputs { x001; }
    }`);
    const card = new JSDOM(reasoningCard(model.steps[0], model)).window.document;
    assert.equal(card.querySelector('.pmc-value').textContent, expected);
    assert.doesNotMatch(card.body.textContent, /Établi|Non établi/);
    assert.match(card.body.textContent, /Hypothèse du scénario/);
    assert.match(reasoningIssues(model)[0].issue, /pièce/i);
  }
});

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
  assert.match(card.querySelector('[data-part="justification"]').textContent, /Mise en demeure Vrai/);
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

test('links the conclusion, data, citations and open actions in one graph', () => {
  const model = reasoning(dot, [module], citations);
  const document = new JSDOM(reasoningGraph(model)).window.document;
  const relation = (from, to) => document.querySelector(`[data-from="${from}"][data-to="${to}"]`);
  assert.ok(relation('x002', 'x001'));
  const piece = document.querySelector('[data-node][data-kind="piece"]');
  assert.match(piece.textContent, /Citation non retrouvée/);
  assert.ok(relation('x001', piece.dataset.node));
  const basis = [...document.querySelectorAll('[data-kind="article"][data-node]')].find((node) => node.textContent.includes('Article 1226'));
  assert.ok(relation('x002', basis.dataset.node));
  assert.equal(document.querySelector('[data-node="x002"]').dataset.open, 'true');
  assert.ok([...document.querySelectorAll('[data-node][data-kind="action"]')].some((node) => /Corriger la citation/.test(node.textContent)));
  const otherQuote = citations.map((citation) => ({ ...citation, quote: 'Autre passage fictif.', status: 'passed' }));
  const unchecked = new JSDOM(reasoningGraph(reasoning(dot, [module], otherQuote))).window.document;
  assert.match(unchecked.querySelector('[data-node][data-kind="piece"]').textContent, /Citation à vérifier/);
  assert.doesNotMatch(unchecked.querySelector('[data-node][data-kind="piece"]').textContent, /Extrait retrouvé/);
  assert.equal(reasoningGraph(reasoning('digraph G {}')), '');
});

test('distinguishes statutes, case law and other references without treating a website as legal authority', () => {
  const file = { ...module, contenu: `${module.contenu}\n## Sources\nConcerne : résolution_possible\n[Décision fictive](https://www.legifrance.gouv.fr/juri/id/JURITEXT000000000001)\n[Documentation](https://example.org/explication)\n` };
  const graph = new JSDOM(reasoningGraph(reasoning(dot, [file], citations))).window.document;
  assert.ok(graph.querySelector('[data-node][data-kind="article"]'));
  assert.match(graph.querySelector('[data-node][data-kind="jurisprudence"]').textContent, /Jurisprudence.*Décision fictive/);
  assert.match(graph.querySelector('[data-node][data-kind="reference"]').textContent, /Autre référence.*Documentation/);
  const webOnly = { ...module, contenu: '## Sources\nConcerne : résolution_possible\n[Documentation](https://example.org/explication)\n' };
  assert.match(reasoning(dot, [webOnly]).steps.find((step) => step.kind === 'rule').issue, /Aucun article ni aucune décision/);
});

test('shares supporting nodes and preserves authored questions, research and native test coverage', () => {
  const file = { ...module, contenu: `${module.contenu}\n## Question\nConcerne : résolution_possible\nQuestion : Peut-on retenir cette solution ?\nJustification : La demande dépend de la condition indiquée.\nÀ rechercher : Obtenir la preuve de réception.\nDémarche : 2026-11-08 | demande de pièce | vérifier la réception | réponse attendue\n` };
  const coverage = { scopes: [{ index: 0, name: 'AvecDemande' }, { index: 1, name: 'SansDemande' }], locations: [{ file: file.chemin, tree: [{ range: { start: { line: 15 }, end: { line: 15 } }, reached_by: [0, 1], subtree: [] }] }] };
  const model = reasoning(dot.replace('  x002 -> x003', '  x004 [label=<<table><tr><td>autre_solution</td></tr><tr><td>mise_en_demeure</td></tr><tr><td>= true</td></tr></table>>];\n  x001 -> x004 [style="solid"];\n  x002 -> x003'), [file], citations, coverage);
  const graph = new JSDOM(reasoningGraph(model)).window.document;
  assert.equal(graph.querySelectorAll('[data-node="x001"]').length, 1);
  assert.ok(graph.querySelector('[data-from="x004"][data-to="x001"]'));
  assert.ok(graph.querySelector('[data-from="x002"][data-to="x001"]'));
  assert.match(graph.querySelector('[data-node="x002"]').textContent, /Peut-on retenir cette solution/);
  assert.match(graph.querySelector('[data-node="x002"]').textContent, /AvecDemande, SansDemande/);
  assert.ok([...graph.querySelectorAll('[data-kind="action"]')].some((node) => /Obtenir la preuve de réception/.test(node.textContent)));
  const card = new JSDOM(reasoningCard(model.steps.find((step) => step.id === 'x002'), model)).window.document;
  assert.match(card.body.textContent, /Démarches effectuées.*réponse attendue/s);
});

test('keeps unknown and disputed facts open without changing their scenario values', () => {
  for (const [value, issue] of [['Inconnu ()', /non établi/], ['Contesté ()', /contesté/]]) {
    const model = reasoning(dot.replace('<td>true</td>', `<td>${value}</td>`), [module], citations);
    const fact = model.steps.find((step) => step.kind === 'fact');
    assert.equal(fact.value, value);
    assert.match(fact.issue, issue);
    const graph = new JSDOM(reasoningGraph(model)).window.document;
    assert.equal(graph.querySelector('[data-node="x002"]').dataset.open, 'true');
  }
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
  const groups = [...document.querySelectorAll('[data-kind="condition"][data-node]')];
  assert.ok(groups.some((node) => node.querySelector('.pmc-node-title').textContent === 'ET'));
  assert.ok(groups.some((node) => node.querySelector('.pmc-node-title').textContent === 'NON'));
  const not = groups.find((node) => node.querySelector('.pmc-node-title').textContent === 'NON');
  assert.ok(document.querySelector(`[data-from="${not.dataset.node}"][data-to="x002"][data-relation="écarte"]`));
  assert.equal(document.querySelectorAll('[data-node="x001"]').length, 1);
  const card = new JSDOM(reasoningText(model)).window.document.querySelector('[data-card="x004"]');
  assert.match(card.querySelector('[data-part="rule"]').textContent, /Sauf\s*Force majeure/);
  assert.match(card.querySelector('[data-part="projection"]').textContent, /Les conditions sont remplies/);
});

test('preserves a conditional dependency without claiming that a dashed link proves an exception', () => {
  const model = reasoning(`digraph G {
    x009 [label=<<table><tr><td colspan="2">Demo.Resolution</td></tr><tr><td>resolution_possible</td><td>false</td></tr></table>>, URL="https://catala.local/demo.catala_fr#L9", shape=plaintext];
    x010 [label=<<table><tr><td><b>resolution_possible</b></td></tr><tr><td><b>= false</b></td></tr></table>>, URL="https://catala.local/demo.catala_fr#L31", style="filled"];
    x011 [label=<<table><tr><td><b>force_majeure</b></td></tr><tr><td><b>= true</b></td></tr></table>>, URL="https://catala.local/test_demo.catala_fr#L13", style="filled"];
    subgraph cluster_inputs { x011; }
    x010 -> x009 [style="solid"];
    x011 -> x010 [style="dashed", color="#FF7700"];
  }`);
  assert.equal(model.steps.find((step) => step.kind === 'rule').conditional, true);
  const document = new JSDOM(reasoningText(model)).window.document;
  const card = document.querySelector('[data-card="x010"]');
  assert.match(card.querySelector('[data-part="rule"]').textContent, /condition d’application/);
  assert.match(card.querySelector('[data-part="projection"]').textContent, /Faux/);
  assert.match(card.querySelector('[data-part="justification"]').textContent, /Force majeure Vrai/);
  const graph = new JSDOM(reasoningGraph(model)).window.document;
  assert.equal(graph.querySelector('[data-node="x010"] .pmc-value').textContent, 'Faux');
  assert.equal(graph.querySelector('[data-node="x011"] .pmc-value').textContent, 'Vrai');
  assert.ok(graph.querySelector('[data-from="x010"][data-to="x011"][data-relation="condition appliquée"]'));
});
