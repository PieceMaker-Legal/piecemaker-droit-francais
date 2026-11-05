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
