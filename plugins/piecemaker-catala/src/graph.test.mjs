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
  assert.equal(document.querySelectorAll('svg[role="img"]').length, 1);
  assert.equal(document.querySelectorAll('rect').length, 3);
  assert.equal(document.querySelectorAll('path[stroke-dasharray]').length, 1);
  assert.match(document.querySelector('svg').textContent, /\$300\.00/);
  assert.match(document.querySelector('svg').textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(document.querySelectorAll('img, script, a, [onerror]').length, 0);
  assert.throws(() => explanationGraph('digraph G { x001 [label=<oops>'), /incomplet/);
  assert.throws(() => explanationGraph(dot.replace('style="invis"', 'style="solid"')), /cycle/);
});
