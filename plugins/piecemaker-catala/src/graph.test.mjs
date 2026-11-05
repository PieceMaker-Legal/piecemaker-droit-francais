import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { explanationGraph } from './graph.ts';

const dom = new JSDOM();
globalThis.DOMParser = dom.window.DOMParser;

const dot = `digraph G {
  x001 [label=<<table><tr><td>annees</td><td>3</td></tr></table>>, style="filled", ];
  x002 [label=<<table><tr><td>montant</td><td>$100.00 × annees</td></tr><tr><td>$300.00</td></tr></table>>, style="filled", ];
  x003 [label=<<table><tr><td>&lt;img src=x onerror=alert(1)&gt;</td></tr></table>>, style="dashed", ];
  subgraph cluster_inputs { x001; };
  x001 -> x002 [weight=10, color="#000000", ];
  x003 -> x002 [style="dashed", ];
  x002 -> x001 [style="invis", ];
}`;

test('draws Catala formulas and conditional dependencies as inert SVG text', () => {
  const document = new JSDOM(explanationGraph(dot)).window.document;
  assert.equal(document.querySelectorAll('svg[role="group"]').length, 1);
  assert.equal(document.querySelectorAll('rect').length, 3);
  assert.equal(document.querySelectorAll('path[stroke-dasharray]').length, 1);
  assert.match(document.querySelector('svg').textContent, /\$300\.00/);
  assert.match(document.querySelector('svg').textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(document.querySelectorAll('img, script, a, [onerror]').length, 0);
  assert.throws(() => explanationGraph('digraph G { x001 [label=<oops>'), /incomplet/);
  assert.throws(() => explanationGraph(dot.replace('style="invis"', 'style="solid"')), /cycle/);
});

test('preserves explicit open states and groups rules, conditions and scenario inputs', () => {
  const graph = `digraph G {
    x001 [label=<<table><tr><td>condition_connue</td></tr><tr><td>= Indéterminé</td></tr></table>>, URL="https://example.test/test_prime.catala_fr#L12", tooltip="Scénario&#10;Fait", style="filled"];
    x002 [label=<condition_connue ≠ Vrai>, style="filled,dashed"];
    x003 [label=<<table><tr><td>prime_due</td></tr><tr><td>= Disputé</td></tr></table>>, style="filled"];
    subgraph cluster_inputs { x001; }
    x001 -> x002 [style="solid"];
    x002 -> x003 [style="dashed"];
  }`;
  const document = new JSDOM(explanationGraph(graph)).window.document;
  const input = document.querySelector('[data-node="x001"]');
  assert.equal(input.dataset.kind, 'input');
  assert.equal(input.dataset.tone, 'warn');
  assert.equal(input.dataset.context, 'Scénario\nFait');
  assert.equal(input.dataset.source, 'https://example.test/test_prime.catala_fr#L12');
  assert.equal(document.querySelector('[data-node="x002"]').dataset.kind, 'condition');
  assert.equal(document.querySelector('[data-node="x003"]').dataset.value, 'Disputé');
  assert.ok(Number(input.querySelector('rect').getAttribute('x')) > Number(document.querySelector('[data-node="x003"] rect').getAttribute('x')));
  assert.equal(document.querySelectorAll('[data-tone="warn"] rect[stroke-dasharray]').length, 2);
  assert.match(input.textContent, /Donnée non établie/);
  assert.match(document.querySelector('[data-node="x003"]').textContent, /Résultat disputé/);
  assert.equal(document.querySelectorAll('.pmc-step-heading[data-step-heading]').length, 1);
  for (const label of document.querySelectorAll('.pmc-node-kind')) assert.doesNotMatch(label.textContent, /Étape/);
});

test('numbers the main calculation path in dependency order', () => {
  const graph = `digraph G {
    x003 [label=<<table><tr><td>resultat</td></tr><tr><td>= 12</td></tr></table>>, shape=plaintext];
    x002 [label=<<table><tr><td>calcul</td></tr><tr><td>= 12</td></tr></table>>];
    x001 [label=<<table><tr><td>donnee</td><td>3</td></tr></table>>];
    subgraph cluster_inputs { x001; };
    x001 -> x002 [style="solid"];
    x002 -> x003 [style="solid"];
  }`;
  const document = new JSDOM(explanationGraph(graph)).window.document;
  assert.equal(document.querySelector('[data-node="x002"]').dataset.step, '1');
  assert.equal(document.querySelector('[data-node="x003"]').dataset.step, '2');
  assert.ok(document.querySelector('svg').textContent.indexOf('Étape 1') < document.querySelector('svg').textContent.indexOf('Étape 2'));
});

test('shows cited documents as graph dependencies and preserves logical expressions with pills', () => {
  const contenu = ['# Sources', '', '[Pièce 1](../../../pieces/attestation.md)', '[Annexe][annexe]', '[Source](https://example.test/source)', '', '```catala-metadata', 'déclaration fait condition', '```', '', '## Article 1218 | LEGIARTI000032041431', '', '```catala', 'définition droit égal à vrai', '```', '', '[annexe]: ../../../pieces/annexe.md'].join('\n');
  const graph = `digraph G {
    x001 [label=<(fait_etabli et (autre_fait ou nom = &quot;et ou&quot;))>, style="filled,dashed", URL="https://example.test/demo.catala_fr#L14"];
    x002 [label=<<table><tr><td>droit</td></tr><tr><td>calcul intermédiaire</td></tr><tr><td>= Vrai</td></tr></table>>, URL="https://example.test/demo.catala_fr#L14"];
    x001 -> x002 [style="dashed"];
  }`;
  const document = new JSDOM(explanationGraph(graph, [{ nom: 'demo.catala_fr', chemin: '/dossier/.piecemaker/catala/demo/demo.catala_fr', contenu }])).window.document;
  const condition = document.querySelector('[data-node="x001"]');
  assert.deepEqual([...condition.querySelectorAll('.pmc-logic-pill')].map((pill) => pill.textContent), ['et', 'ou']);
  assert.equal(condition.querySelector('.pmc-condition-expression').textContent, '(fait_etabli et (autre_fait ou nom = "et ou"))');
  for (const [kind, title] of [['piece', 'Pièce 1'], ['piece', 'Annexe'], ['reference', 'Source'], ['article', 'Article 1218']]) {
    const reference = [...document.querySelectorAll(`[data-kind="${kind}"]`)].find((node) => node.dataset.title === title);
    assert.ok(reference, `${title} doit figurer dans le graphe`);
    assert.ok(document.querySelector(`[data-from="${reference.dataset.node}"][data-to="x001"]`));
    assert.match(reference.dataset.literaryContext, /Article 1218/);
    assert.ok(document.querySelector(`[data-from="${reference.dataset.node}"][data-to="x002"]`));
  }
  assert.equal(document.querySelectorAll('[data-kind="piece"][data-title="Pièce 1"]').length, 1);
  assert.match(document.querySelector('[data-node="x002"]').dataset.expression, /calcul intermédiaire/);
  assert.equal(document.querySelectorAll('a, script, img, [onerror]').length, 0);
});


test('unfolds nested conditions to the right without flattening their dependencies', () => {
  const document = new JSDOM(explanationGraph(`digraph G {
    x001 [label=<<table><tr><td>fait</td><td>Vrai</td></tr></table>>];
    x002 [label=<fait>, style="dashed"];
    x003 [label=<autre_condition et fait>, style="dashed"];
    x004 [label=<<table><tr><td>droit</td><td>Vrai</td></tr></table>>];
    subgraph cluster_inputs { x001; }
    x001 -> x002 [style="solid"];
    x002 -> x003 [style="dashed"];
    x003 -> x004 [style="dashed"];
  }`)).window.document;
  const x = (id) => Number(document.querySelector(`[data-node="${id}"] rect`).getAttribute('x'));
  assert.ok(x('x004') < x('x003'));
  assert.ok(x('x003') < x('x002'));
  assert.ok(x('x002') < x('x001'));
  for (const node of document.querySelectorAll('[data-node]')) assert.equal(node.dataset.step, '1');
});

test('keeps distinct passages of the same article attached to their own rules', () => {
  const contenu = ['## Première', '[Article](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000000000001)', 'Citation : « Premier passage. »', '', '```catala', 'premiere', '```', '## Seconde', '[Article](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000000000001)', 'Citation : « Second passage. »', '', '```catala', 'seconde', '```'].join('\n');
  const graph = 'digraph G { x001 [label=<premiere>, URL="https://example.test/demo.catala_fr#L6"]; x002 [label=<seconde>, URL="https://example.test/demo.catala_fr#L13"]; }';
  const document = new JSDOM(explanationGraph(graph, [{ nom: 'demo.catala_fr', chemin: '/dossier/demo.catala_fr', contenu }])).window.document;
  for (const [quote, rule, other] of [['Premier passage.', 'x001', 'x002'], ['Second passage.', 'x002', 'x001']]) {
    const reference = [...document.querySelectorAll('[data-kind="article"]')].find((node) => node.dataset.quote === quote);
    assert.ok(reference);
    assert.ok(document.querySelector(`[data-from="${reference.dataset.node}"][data-to="${rule}"]`));
    assert.equal(document.querySelector(`[data-from="${reference.dataset.node}"][data-to="${other}"]`), null);
  }
});
