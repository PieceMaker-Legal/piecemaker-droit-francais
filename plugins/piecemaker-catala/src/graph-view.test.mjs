import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const contenu = ['> Module Demo', '', '## Article 1217', '', '[Article 1217](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032041431)', 'Citation : « Passage juridique fictif. »', '', '```catala', 'définition sanction_possible égal à inexécution', '```', '', '## Pièce 1', '', 'Concerne : inexécution', '', '[Attestation de Jean Dupont](../../../pieces/attestation.md)', 'Citation : « Société Exemple SAS n’a pas livré. »', '', '## Hors dossier', '', '[Hors dossier](../../../../hors-dossier.md)', '[Décision fictive](https://www.courdecassation.fr/decision/abcdef0123456789abcdef01)'].join('\n');
const graphe = `digraph G {
  x001 [label=<<table><tr><td>inexécution</td><td>true</td></tr></table>>, URL="https://catala.local/test_demo.catala_fr#L9", style="filled"];
  x002 [label=<<table><tr><td>sanction_possible</td></tr><tr><td>inexécution</td></tr><tr><td>=</td></tr><tr><td>true</td></tr></table>>, URL="https://catala.local/demo.catala_fr#L9", style="filled"];
  subgraph cluster_inputs { x001; }
  x001 -> x002 [style="solid"];
}`;
const program = (changes = {}) => ({ nom: 'demo', enCours: false, perimee: false, fichiers: [{ nom: 'demo.catala_fr', chemin: '/dossier/.piecemaker/catala/demo/demo.catala_fr', contenu }], journaux: [], verification: { started_utc: '2026-11-05T09:59:58Z', finished_utc: '2026-11-05T10:00:00Z', passed: true, checks: [] }, citations: { results: [] }, preuve: null, catleg: null, explication: { passed: true, fichier: 'test_demo.catala_fr', scope: 'Test', started_utc: '2026-11-05T09:59:58Z', finished_utc: '2026-11-05T10:00:00Z', checks: [] }, graphe, ...changes });

async function open(programmes, fetchMore = async () => null) {
  const { mount, unmount } = await import('./client.ts');
  const dom = new JSDOM('<div id="panel"></div><div id="outside"></div>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.localStorage = { getItem: () => null };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => (await fetchMore(url, options)) ?? new Response(JSON.stringify({ pack: { id: 'pack', platform: 'darwin', version: '1.3', proof: true, installedAt: '2026-11-01' }, status: null, programmes }));
  const container = dom.window.document.querySelector('#panel');
  mount(container, { context: { theme: 'light', project: { name: 'fictif', path: '/dossier' } }, onContextChange: () => () => {} });
  await new Promise((resolve) => setImmediate(resolve));
  const opened = [];
  window.addEventListener('piecemaker:open-in-editor', (event) => opened.push(event.detail));
  const click = (element) => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  return { dom, container, opened, click, close: () => { unmount(container); globalThis.fetch = previousFetch; dom.window.close(); } };
}

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


test('shows each rule with its legal basis and no code checks', async () => {
  const view = await open([program()]);
  try {
    const written = view.container.querySelector('.pmc-written');
    assert.equal(written.hidden, false);
    assert.match(view.container.querySelector('.pmc-run').textContent, /Raisonnement vérifié/);
    const card = written.querySelector('[data-card="x002"]');
    assert.equal(card.querySelector('h3').textContent, 'Sanction possible');
    assert.equal(card.querySelector('.pmc-value').textContent, 'Vrai');
    assert.match(card.textContent, /Article 1217/);
    assert.match(card.textContent, /Passage juridique fictif/);
    assert.match(card.querySelector('.pmc-application').textContent, /Inexécution/);
    assert.doesNotMatch(view.container.textContent, /Étape|typecheck|Contrôles|clerk|test_demo|catleg/i);
    assert.match(written.textContent, /Autres sources citées/);
  } finally { view.close(); }
});

test('opens cited articles and pieces in the editor without leaving the written view', async () => {
  const requests = [];
  const view = await open([program()], async (url, options) => url.endsWith('/citation') ? (requests.push(JSON.parse(options.body)), new Response(JSON.stringify({ token: 'a'.repeat(64) }))) : null);
  try {
    const links = () => [...view.container.querySelectorAll('.pmc-written [data-open-reference]')];
    view.click(links().find((link) => link.textContent === 'Article 1217'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(view.opened.at(-1).path, /^piecemaker:\/\/citation\/a{64}\/LEGIARTI000032041431$/);
    assert.equal(requests[0].citation, 'Passage juridique fictif.');
    assert.equal(view.container.querySelector('.pmc-written').hidden, false);
    view.click(links().find((link) => link.textContent === 'Attestation de Jean Dupont'));
    assert.deepEqual(view.opened.at(-1), { path: '/dossier/pieces/attestation.md', passage: { quote: 'Société Exemple SAS n’a pas livré.' } });
    const count = view.opened.length;
    view.click(links().find((link) => link.textContent === 'Hors dossier'));
    assert.equal(view.opened.length, count);
    view.click(links().find((link) => link.textContent === 'Décision fictive'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(view.opened.at(-1).path, /\/abcdef0123456789abcdef01$/);
  } finally { view.close(); }
});

test('the graph details a node with its card and opens its sources', async () => {
  const view = await open([program()]);
  try {
    view.click(view.container.querySelector('[role="tab"][data-mode="graph"]'));
    assert.equal(view.container.querySelector('.pmc-explanation').hidden, false);
    assert.deepEqual([...view.container.querySelectorAll('[data-node]')].map((node) => node.dataset.kind), ['fact', 'rule']);
    view.click(view.container.querySelector('[data-node="x001"]'));
    const inspector = view.container.querySelector('.pmc-inspector');
    assert.equal(inspector.hidden, false);
    assert.match(inspector.textContent, /Attestation de Jean Dupont/);
    assert.ok(view.container.querySelector('[data-node="x002"]').classList.contains('is-dim'));
    view.click(inspector.querySelector('[data-open-reference]'));
    assert.equal(view.opened.at(-1).path, '/dossier/pieces/attestation.md');
    view.click(view.dom.window.document.querySelector('#outside'));
    assert.equal(inspector.hidden, true);
    assert.equal(view.container.querySelectorAll('.is-dim').length, 0);
  } finally { view.close(); }
});

test('asks for a verification when the trace is missing or stale', async () => {
  const view = await open([program({ perimee: true }), program({ nom: 'autre', graphe: null, explication: null, verification: null })]);
  try {
    assert.match(view.container.querySelector('.pmc-run').textContent, /Modifié depuis la vérification/);
    assert.match(view.container.querySelector('.pmc-written').textContent, /lancez la vérification/);
    const select = view.container.querySelector('[data-program-choice]');
    select.value = 'autre';
    select.dispatchEvent(new view.dom.window.Event('change', { bubbles: true }));
    assert.match(view.container.querySelector('.pmc-run').textContent, /Jamais vérifié/);
  } finally { view.close(); }
});
