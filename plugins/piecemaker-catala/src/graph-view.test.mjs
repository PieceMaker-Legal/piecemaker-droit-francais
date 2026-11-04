import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { explanationGraph } from './graph.ts';
import { mountExplanation } from './graph-view.ts';

test('navigates the execution, exposes open states and releases replay on unmount', () => {
  const dom = new JSDOM('<section data-mode="graph"><select data-result></select><div class="pmc-open-states"></div><button data-mode="graph"></button><button data-mode="written"></button><div class="pmc-canvas"><div class="pmc-stage"></div><aside class="pmc-inspector" hidden></aside><div class="pmc-legend" hidden></div></div><div class="pmc-written"></div><button data-legend></button><button data-fit></button><button data-zoom="1.2"></button><button data-replay></button></section>');
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.window = dom.window;
  const container = dom.window.document.querySelector('section');
  container.querySelector('.pmc-stage').innerHTML = explanationGraph(`digraph G {
    x001 [label=<<table><tr><td>fait_attendu</td></tr><tr><td>= Indéterminé</td></tr></table>>, URL="https://example.test/test_prime.catala_fr#L10", style="filled"];
    x002 [label=<<table><tr><td>prime_due</td></tr><tr><td>= Faux</td></tr></table>>, style="filled"];
    subgraph cluster_inputs { x001; }
    x001 -> x002 [style="solid"];
  }`);
  const opened = [];
  const unmount = mountExplanation(container, (source) => opened.push(source));
  const click = (selector) => container.querySelector(selector).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.match(container.querySelector('.pmc-open-states').textContent, /1 état/);
  click('[data-node="x002"]');
  assert.equal(container.querySelector('.pmc-inspector').hidden, false);
  assert.match(container.querySelector('.pmc-inspector').textContent, /Dépend de/);
  assert.match(container.querySelector('.pmc-inspector').textContent, /Faux/);
  click('.pmc-inspector [data-select-node="x001"]');
  assert.match(container.querySelector('.pmc-inspector').textContent, /Donnée fournie/);
  assert.match(container.querySelector('.pmc-inspector').textContent, /État ouvert/);
  click('[data-open-source]');
  assert.deepEqual(opened, ['https://example.test/test_prime.catala_fr#L10']);
  click('[data-mode="written"]');
  assert.equal(container.dataset.mode, 'written');
  assert.equal(container.querySelectorAll('.pmc-written .pmc-phase').length, 2);
  click('.pmc-written [data-select-node="x002"]');
  assert.equal(container.dataset.mode, 'graph');
  assert.equal(container.querySelector('[data-mode="graph"]').getAttribute('aria-selected'), 'true');
  click('[data-legend]');
  assert.equal(container.querySelector('.pmc-legend').hidden, false);
  click('[data-replay]');
  assert.equal(container.querySelectorAll('.pmc-node.is-waiting').length, 1);
  unmount();
  assert.equal(container.querySelectorAll('.is-waiting').length, 0);
  click('[data-node="x001"]');
  assert.equal(container.querySelector('.pmc-inspector').hidden, true);
  dom.window.close();
});

test('the panel reloads after verification notifications for its project and stops on unmount', async () => {
  const { mount, unmount } = await import('./client.ts');
  const dom = new JSDOM('<div id="panel"></div>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.localStorage = { getItem: () => null };
  let requests = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    requests++;
    return new Response(JSON.stringify({ pack: null, status: null, programmes: [] }), { headers: { 'Content-Type': 'application/json' } });
  };
  const container = dom.window.document.querySelector('#panel');
  try {
    mount(container, { context: { theme: 'light', project: { name: 'fictif', path: '/dossier-fictif' } }, onContextChange: () => () => {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests, 1);
    window.dispatchEvent(new CustomEvent('piecemaker:catala-updated', { detail: { projectPath: '/autre-dossier' } }));
    assert.equal(requests, 1);
    window.dispatchEvent(new CustomEvent('piecemaker:catala-updated', { detail: { projectPath: '/dossier-fictif' } }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests, 2);
    unmount(container);
    window.dispatchEvent(new CustomEvent('piecemaker:catala-updated', { detail: { projectPath: '/dossier-fictif' } }));
    assert.equal(requests, 2);
  } finally { unmount(container); globalThis.fetch = previousFetch; dom.window.close(); }
});
