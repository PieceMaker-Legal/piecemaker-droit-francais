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
    assert.equal(view.container.querySelector('.pmc-explanation').hidden, false);
    view.click(view.container.querySelector('[role=tab][data-mode=written]'));
    const written = view.container.querySelector('.pmc-written');
    assert.equal(written.hidden, false);
    assert.match(view.container.querySelector('.pmc-run').textContent, /Recalculer/);
    assert.doesNotMatch(view.container.querySelector('.pmc-run').textContent, /vérifié|vérification/i);
    const card = written.querySelector('[data-card="x002"]');
    assert.equal(card.querySelector('h3').textContent, 'Sanction possible');
    assert.equal(card.querySelector('[data-part="projection"] .pmc-value').textContent, 'Vrai');
    assert.match(card.textContent, /Article 1217/);
    assert.match(card.textContent, /Passage juridique fictif/);
    assert.match(card.querySelector('[data-part="justification"]').textContent, /Inexécution/);
    assert.doesNotMatch(view.container.textContent, /Étape|typecheck|Contrôles|clerk|test_demo|catleg/i);
    assert.match(written.textContent, /Autres sources citées/);
  } finally { view.close(); }
});

test('opens cited articles and pieces in the editor without leaving the written view', async () => {
  const requests = [];
  const view = await open([program()], async (url, options) => url.endsWith('/citation') ? (requests.push(JSON.parse(options.body)), new Response(JSON.stringify({ token: 'a'.repeat(64) }))) : null);
  try {
    view.click(view.container.querySelector('[role=tab][data-mode=written]'));
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
    assert.ok(view.container.querySelector('[data-node][data-kind=condition] [data-part=evidence] [data-kind=piece]'));
    assert.equal(view.container.querySelectorAll('[data-node][data-kind=origin]').length, 0);
    view.click(view.container.querySelector('[data-node][data-kind="rule"]'));
    assert.match(view.container.querySelector('.pmc-inspector').textContent, /Sanction possible/);
    view.click(view.container.querySelector('[data-node][data-kind="condition"]'));
    const inspector = view.container.querySelector('.pmc-inspector');
    assert.equal(inspector.hidden, false);
    assert.match(inspector.textContent, /Attestation de Jean Dupont/);
    assert.match(inspector.textContent, /Condition de droit/);
    assert.equal(view.container.querySelectorAll('.pmc-map .is-selected').length, 1);
    view.click(view.container.querySelector('[data-map-zoom=in]'));
    assert.ok(Number(view.container.querySelector('.pmc-map').dataset.scale) > 1);
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
    assert.match(view.container.querySelector('.pmc-run').textContent, /Raisonnement à recalculer/);
    assert.match(view.container.querySelector('.pmc-written').textContent, /Aucun raisonnement calculé pour ce scénario/);
    const select = view.container.querySelector('[data-program-choice]');
    select.value = 'autre';
    select.dispatchEvent(new view.dom.window.Event('change', { bubbles: true }));
    assert.match(view.container.querySelector('.pmc-run').textContent, /Aucun raisonnement calculé/);
  } finally { view.close(); }
});

test('changes the graph using stored Catala scenarios without recomputing or hiding a failed test', async () => {
  let requests = 0;
  const scenarios = [
    { fichier: 'test_demo.catala_fr', scope: 'Test', passed: true, test_reussi: true, graphe, message: '' },
    { fichier: 'test_demo.catala_fr', scope: 'SansDemande', passed: true, test_reussi: true, graphe: graphe.replaceAll('true', 'false'), message: '' },
    { fichier: 'test_demo.catala_fr', scope: 'TestErrone', passed: false, test_reussi: false, graphe: '', message: 'Assertion fausse.' },
  ];
  const view = await open([program({ scenarios })], async () => { requests++; return null; });
  try {
    const choose = (scope) => {
      const select = view.container.querySelector('[data-scenario-choice]');
      select.value = `test_demo.catala_fr:${scope}`;
      select.dispatchEvent(new view.dom.window.Event('change', { bubbles: true }));
    };
    const initial = requests;
    choose('SansDemande');
    assert.equal(view.container.querySelector('[data-node="x002"] .pmc-value').textContent, 'Faux');
    choose('TestErrone');
    assert.match(view.container.querySelector('.pmc-explanation').textContent, /ne produit pas de graphe/);
    assert.equal(view.container.querySelectorAll('[data-node]').length, 0);
    assert.equal(requests, initial);
  } finally { view.close(); }
});

test('shows a native JSON graph when the scenario has no DOT and keeps its provenance in the inspector', async () => {
  const position = { file: '/dossier/.piecemaker/catala/demo/demo.catala_fr', start: { line: 9, character: 1 }, end: { line: 9, character: 50 }, law_headings: ['Article 1217'] };
  const provenance = { trace: [{ element: { kind: 'scope_call', name: 'Demo', decl_pos: position }, pos: position, value: {}, trace: [{ element: { kind: 'scope_var', name: 'sanction_possible', output: true, decl_pos: position }, pos: position, value: true, trace: [{ element: { kind: 'exception' }, pos: position, value: true }] }] }], definitions: [], dependencies: [], issues: ['Graphe issu de la trace JSON.'] };
  const view = await open([program({ graphe: '', scenarios: [{ fichier: 'test_demo.catala_fr', scope: 'Test', passed: true, test_reussi: true, graphe: '', message: '', provenance }] })]);
  try {
    assert.ok(view.container.querySelector('[data-node][data-kind="answer"]'));
    assert.doesNotMatch(view.container.querySelector('.pmc-map-summary').textContent, /trace JSON/);
    assert.doesNotMatch(view.container.querySelector('.pmc-map').textContent, /Origine native|Ligne 9/);
    view.click(view.container.querySelector('[data-node][data-kind="answer"]'));
    view.click(view.container.querySelector('.pmc-inspector .pmc-native summary'));
    assert.match(view.container.querySelector('.pmc-inspector').textContent, /Origine native Catala.*Article 1217/s);
    assert.equal(view.container.querySelector('.pmc-inspector .pmc-native').open, true);
    assert.match(view.container.querySelector('.pmc-inspector .pmc-native').textContent, /trace JSON/);
  } finally { view.close(); }
});

test('redraws links at card boundaries after resize and releases its observer', async () => {
  const { mountExplanation } = await import('./graph-view.ts');
  const dom = new JSDOM('<main><div class="pmc-map"><svg><g data-from="a" data-to="b"><path/><text>requiert</text></g></svg><div data-node="a"></div><div data-node="b"></div></div></main>');
  let redraw;
  let disconnected = false;
  dom.window.ResizeObserver = class { constructor(callback) { redraw = callback; } observe() {} disconnect() { disconnected = true; } };
  const view = dom.window.document.querySelector('main');
  const canvas = view.querySelector('.pmc-map');
  const [from, to] = view.querySelectorAll('[data-node]');
  canvas.getBoundingClientRect = () => ({ left: 100, top: 50 });
  from.getBoundingClientRect = () => ({ right: 350, top: 90, height: 80 });
  let targetLeft = 450;
  to.getBoundingClientRect = () => ({ left: targetLeft, top: 140, height: 100 });
  const stop = mountExplanation(view, () => {});
  try {
    assert.match(view.querySelector('path').getAttribute('d'), /^M 250 80 .* 350 140$/);
    targetLeft = 550;
    redraw();
    assert.match(view.querySelector('path').getAttribute('d'), /^M 250 80 .* 450 140$/);
    assert.equal(view.querySelector('text').getAttribute('x'), '350');
  } finally { stop(); dom.window.close(); }
  assert.equal(disconnected, true);
});
