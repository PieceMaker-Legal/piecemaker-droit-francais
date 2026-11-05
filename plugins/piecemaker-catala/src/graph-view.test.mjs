import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { explanationGraph } from './graph.ts';
import { mountExplanation } from './graph-view.ts';

test('navigates the execution, exposes open states and releases replay on unmount', () => {
  const dom = new JSDOM('<section class="pmc-view" data-mode="graph"><div role="tablist"><button role="tab" data-mode="graph" aria-selected="true"></button><button role="tab" data-mode="written" aria-selected="false"></button></div><div class="pmc-explanation"><select data-result></select><div class="pmc-open-states"></div><div class="pmc-canvas"><div class="pmc-stage"></div><aside class="pmc-inspector" hidden></aside><div class="pmc-legend" hidden></div></div></div><div class="pmc-written" hidden><div class="pmc-step-list"></div></div><button data-legend></button><button data-fit></button><button data-zoom="1.2"></button><button data-replay></button></section>');
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.window = dom.window;
  const container = dom.window.document.querySelector('section');
  container.querySelector('.pmc-stage').innerHTML = explanationGraph(`digraph G {
    x001 [label=<<table><tr><td>fait_attendu</td></tr><tr><td>= Indéterminé</td></tr></table>>, URL="https://example.test/test_prime.catala_fr#L10", style="filled"];
    x002 [label=<<table><tr><td>prime_due</td></tr><tr><td>= Faux</td></tr></table>>, style="filled"];
    x003 [label=<<table><tr><td>conclusion</td></tr><tr><td>= Faux</td></tr></table>>, shape=plaintext];
    subgraph cluster_inputs { x001; }
    x001 -> x002 [style="solid"];
    x002 -> x003 [style="solid"];
  }`);
  const opened = [];
  const unmount = mountExplanation(container, (source) => opened.push(source));
  const click = (selector) => container.querySelector(selector).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.match(container.querySelector('.pmc-open-states').textContent, /1 point/);
  click('[data-node="x002"]');
  assert.equal(container.querySelector('.pmc-inspector').hidden, false);
  assert.match(container.querySelector('.pmc-inspector').textContent, /Dépend de/);
  assert.match(container.querySelector('.pmc-inspector').textContent, /Faux/);
  click('.pmc-inspector [data-select-node="x001"]');
  assert.match(container.querySelector('.pmc-inspector').textContent, /Donnée fournie/);
  assert.match(container.querySelector('.pmc-inspector').textContent, /Donnée non établie/);
  click('[data-open-source]');
  assert.deepEqual(opened, ['https://example.test/test_prime.catala_fr#L10']);
  click('[data-mode="written"]');
  assert.equal(container.dataset.mode, 'written');
  assert.equal(container.querySelectorAll('.pmc-written .pmc-phase').length, 3);
  click('.pmc-written [data-select-node="x002"]');
  assert.equal(container.dataset.mode, 'graph');
  assert.equal(container.querySelector('[data-mode="graph"]').getAttribute('aria-selected'), 'true');
  click('[data-legend]');
  assert.equal(container.querySelector('.pmc-legend').hidden, false);
  const ticks = [];
  dom.window.setTimeout = (callback) => { ticks.push(callback); return ticks.length; };
  click('[data-replay]');
  assert.equal(container.querySelectorAll('.pmc-node.is-waiting').length, 2);
  assert.equal(container.querySelector('[data-node="x001"]').getAttribute('aria-hidden'), 'true');
  ticks.shift()();
  assert.equal(container.querySelector('[data-node="x001"]').classList.contains('is-waiting'), false);
  assert.equal(container.querySelector('[data-node="x003"]').classList.contains('is-waiting'), true);
  assert.equal(container.querySelector('[data-node="x002"]').getAttribute('aria-pressed'), 'true');
  assert.match(container.querySelector('.pmc-stage').style.transform, /translate/);
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

test('keeps the written tab and program controls available for a stale trace', async () => {
  const { mount, unmount } = await import('./client.ts');
  const dom = new JSDOM('<div id="panel"></div>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.localStorage = { getItem: () => null };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ pack: null, status: null, programmes: [{ nom: 'regle-demo', enCours: false, perimee: true, fichiers: [{ nom: 'demo.catala_fr', chemin: '/dossier/demo.catala_fr' }], journaux: [], verification: null, preuve: null, catleg: null, explication: null, graphe: null }] }), { headers: { 'Content-Type': 'application/json' } });
  const container = dom.window.document.querySelector('#panel');
  try {
    mount(container, { context: { theme: 'light', project: { name: 'fictif', path: '/dossier-fictif' } }, onContextChange: () => () => {} });
    await new Promise((resolve) => setImmediate(resolve));
    const graphTab = container.querySelector('[data-mode="graph"]');
    const writtenTab = container.querySelector('[data-mode="written"]');
    assert.ok(graphTab && writtenTab);
    assert.equal(container.querySelector('.pmc-explanation').hidden, false);
    writtenTab.click();
    assert.equal(container.querySelector('.pmc-explanation').hidden, true);
    assert.equal(container.querySelector('.pmc-written').hidden, false);
    assert.match(container.querySelector('.pmc-written').textContent, /Contrôles et fichiers/);
    assert.match(container.querySelector('.pmc-written').textContent, /demo.catala_fr/);
    assert.ok(container.querySelector('.pmc-explanation [data-kind="control"]'));
    assert.equal(container.querySelector('.pmc-explanation [data-node^="x"]'), null);
    unmount(container);
  } finally { unmount(container); globalThis.fetch = previousFetch; dom.window.close(); }
});

test('separates the views, orders steps and keeps each source context through refresh', async () => {
  const { mount, unmount } = await import('./client.ts');
  const dom = new JSDOM('<div id="panel"></div>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.localStorage = { getItem: () => null };
  const previousFetch = globalThis.fetch;
  const contenu = ['## Première', '', 'Pièce : [Attestation fictive](../../../pieces/attestation.md).', '', '```catala', 'définition premiere égal à vrai', '```', '', '## Seconde', '', 'Pièce : <img src=x onerror=alert(1)> Document fictif.', '', '```catala', 'définition seconde égal à premiere', '```'].join('\n');
  const graphe = `digraph G {
    x003 [label=<<table><tr><td>reponse</td></tr><tr><td>= Vrai</td></tr></table>>, shape=plaintext, URL="https://example.test/demo.catala_fr#L14"];
    x001 [label=<<table><tr><td>donnee</td></tr><tr><td>= Vrai</td></tr></table>>, URL="https://example.test/demo.catala_fr#L999"];
    x002 [label=<<table><tr><td>premiere</td></tr><tr><td>= Vrai</td></tr></table>>, URL="https://example.test/demo.catala_fr#L6"];
    subgraph cluster_inputs { x001; }
    x001 -> x003 [style="solid"];
    x002 -> x003 [style="solid"];
  }`;
  const snapshot = { pack: null, status: null, programmes: [{ nom: 'regle-demo', enCours: false, perimee: false, fichiers: [{ nom: 'demo.catala_fr', chemin: '/dossier-fictif/demo.catala_fr', contenu }], journaux: [], verification: null, preuve: null, catleg: null, explication: { passed: true, fichier: 'demo.catala_fr', scope: 'Exemple', finished_utc: '2026-11-05T10:00:00Z' }, graphe }] };
  globalThis.fetch = async () => new Response(JSON.stringify(snapshot));
  const container = dom.window.document.querySelector('#panel');
  try {
    mount(container, { context: { theme: 'light', project: { name: 'fictif', path: '/dossier-fictif' } }, onContextChange: () => () => {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(container.querySelectorAll('[role="tab"]').length, 2);
    assert.equal(container.querySelector('.pmc-written').hidden, true);
    assert.equal(container.querySelector('.pmc-explanation details.pmc-part'), null);
    container.querySelector('[role="tab"][data-mode="written"]').click();
    assert.equal(container.querySelector('.pmc-explanation').hidden, true);
    assert.deepEqual([...container.querySelectorAll('.pmc-written-step h3')].map((heading) => heading.textContent), ['Étape 1 · premiere', 'Réponse · Étape 2 · reponse', 'Contrôles et références hors trace']);
    const contexts = ['x002', 'x003'].map((id) => container.querySelector(`.pmc-written .pmc-phase header [data-select-node="${id}"]`).closest('.pmc-phase').querySelector('.pmc-source-text').textContent);
    assert.match(contexts[0], /Attestation fictive/);
    assert.doesNotMatch(contexts[0], /Document fictif/);
    assert.match(contexts[1], /Document fictif/);
    assert.doesNotMatch(contexts[1], /Attestation fictive/);
    assert.equal(container.querySelectorAll('img, script, [onerror]').length, 0);
    snapshot.programmes[0].perimee = true;
    window.dispatchEvent(new CustomEvent('piecemaker:catala-updated', { detail: { projectPath: '/dossier-fictif' } }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(container.querySelector('[role="tab"][data-mode="written"]').getAttribute('aria-selected'), 'true');
    assert.equal(container.querySelector('.pmc-written').hidden, false);
    assert.match(container.querySelector('.pmc-written').textContent, /Contrôles et fichiers/);
  } finally { unmount(container); globalThis.fetch = previousFetch; dom.window.close(); }
});

test('opens cited pieces and sources while keeping local links inside the dossier', async () => {
  const { mount, unmount } = await import('./client.ts');
  const dom = new JSDOM('<div id="panel"></div>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.localStorage = { getItem: () => null };
  const previousFetch = globalThis.fetch;
  const contenu = ['## Fait', '', '[Attestation fictive](../../../pieces/attestation.md)', '[Article 1218](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032041431)', '[Hors dossier](../../../../hors-dossier.md)', '[Chemin encodé](../../../pieces/..%2f..%2fhors-dossier.md)', '[Protocole refusé](javascript:alert%281%29)', '', '```catala', 'définition fait égal à vrai', '```', '', '## Autre fondement', '[Jurisprudence fictive](https://www.legifrance.gouv.fr/juri/id/JURITEXT000000000001)', 'Pièce 99'].join('\n');
  const graphe = 'digraph G { x001 [label=<<table><tr><td>fait</td></tr><tr><td>= Vrai</td></tr></table>>, URL="https://example.test/demo.catala_fr#L10"]; }';
  globalThis.fetch = async () => new Response(JSON.stringify({ pack: null, status: null, programmes: [{ nom: 'demo', enCours: false, perimee: false, fichiers: [{ nom: 'demo.catala_fr', chemin: '/dossier/.piecemaker/catala/demo/demo.catala_fr', contenu }], journaux: [{ nom: 'typecheck.log', chemin: '/dossier/.piecemaker/catala/demo/resultats/typecheck.log', contenu: 'demo.catala_fr:14: Type incompatible : entier attendu, date reçue.' }], verification: { finished_utc: '2026-11-05T10:00:00Z', started_utc: '2026-11-05T09:59:58Z', passed: false, checks: [{ name: 'typecheck', command: 'catala typecheck demo.catala_fr', exit_code: 1, seconds: 2, passed: false }] }, tests: { 'test-results': [{ file: 'demo.catala_fr', tests: { scopes: [{ scope_name: 'Exemple', success: false, errors: ['Assertion fictive non satisfaite'], time: 0.1 }] } }], coverage: { regle: 'non couverte' } }, preuve: { passed: true, fichier: 'demo.catala_fr', scope: 'Exemple', conflits: 0, obligations: 3, started_utc: '2026-11-05T09:59:58Z', finished_utc: '2026-11-05T10:00:00Z', checks: [] }, catleg: { date_controle: '2026-11-05', passed: false, fichiers: [{ fichier: 'demo.catala_fr', passed: false, messages: ['Article à revoir : version abrogée'] }] }, explication: { passed: true, fichier: 'demo.catala_fr', scope: 'Exemple', finished_utc: '2026-11-05T10:00:00Z' }, graphe }] }));
  const opened = [];
  const external = [];
  window.addEventListener('piecemaker:open-in-editor', (event) => opened.push(event.detail.path));
  window.open = (...args) => external.push(args);
  const container = document.querySelector('#panel');
  try {
    mount(container, { context: { theme: 'light', project: { name: 'fictif', path: '/dossier' } }, onContextChange: () => () => {} });
    await new Promise((resolve) => setImmediate(resolve));
    const open = (title) => {
      const card = [...container.querySelectorAll('.pmc-node')].find((node) => node.dataset.title === title);
      assert.ok(card, `${title} doit être montré`);
      card.querySelector('[data-open-reference]').click();
    };
    open('Attestation fictive');
    assert.deepEqual(opened, ['/dossier/pieces/attestation.md']);
    open('Article 1218');
    assert.deepEqual(external, [['https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032041431', '_blank', 'noopener,noreferrer']]);
    open('Jurisprudence fictive');
    assert.equal(external[1][0], 'https://www.legifrance.gouv.fr/juri/id/JURITEXT000000000001');
    const article = container.querySelector('[data-kind="article"][data-title="Article 1218"]');
    assert.match(article.textContent, /2026-11-05/);
    assert.match(article.textContent, /version abrogée/);
    assert.match(article.textContent, /date des faits : non contrôlée/);
    const check = [...container.querySelectorAll('[data-kind="control"]')].find((node) => node.dataset.title === 'Typage et invariants');
    assert.equal(check.dataset.tone, 'ko');
    const rule = container.querySelector('[data-node="x001"]');
    assert.equal(rule.querySelector(`[data-select-node="${check.dataset.node}"]`), null);
    assert.match(check.textContent, /Type incompatible : entier attendu, date reçue/);
    assert.equal(container.querySelector(`[data-relation="control"][data-from="${check.dataset.node}"][data-to="x001"]`), null);
    const vigour = [...container.querySelectorAll('[data-kind="control"]')].find((node) => node.dataset.title === 'Vigueur · demo.catala fr');
    assert.ok(container.querySelector(`[data-relation="control"][data-from="${vigour.dataset.node}"][data-to="${article.dataset.node}"]`));
    assert.ok([...container.querySelector('[data-result]').options].some((option) => option.value === check.dataset.node));
    assert.equal(container.querySelector('[data-title="Jurisprudence fictive"]').dataset.kind, 'jurisprudence');
    check.querySelector('[data-open-reference]').click();
    assert.equal(opened[1], '/dossier/.piecemaker/catala/demo/resultats/typecheck.log');
    const proof = [...container.querySelectorAll('[data-kind="control"]')].find((node) => node.dataset.title === 'Preuve');
    assert.match(proof.textContent, /3 obligations produites/);
    const tests = [...container.querySelectorAll('[data-kind="control"]')].find((node) => node.dataset.title === 'Scénarios et couverture des tests');
    tests.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.match(tests.textContent, /Assertion fictive non satisfaite/);
    assert.match(container.querySelector('.pmc-inspector').textContent, /Assertion fictive non satisfaite/);
    assert.match(container.querySelector('.pmc-inspector').textContent, /non couverte/);
    const missing = [...container.querySelectorAll('.pmc-node')].find((node) => node.dataset.title === 'Pièce 99');
    missing.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.match(missing.textContent, /renseignez le chemin/);
    assert.match(container.querySelector('.pmc-inspector').textContent, /Lien absent du programme/);
    container.querySelector('[role="tab"][data-mode="written"]').click();
    container.querySelector(`.pmc-written [data-open-reference="${article.dataset.node}"]`).click();
    assert.equal(external.length, 3);
    for (const title of ['Hors dossier', 'Chemin encodé', 'Protocole refusé']) open(title);
    assert.equal(opened.length, 2);
    assert.equal(external.length, 3);
    assert.match(container.querySelector('.pmc-written').textContent, /Attestation fictive/);
    assert.match(container.querySelector('.pmc-written').textContent, /Article 1218/);
  } finally { unmount(container); globalThis.fetch = previousFetch; dom.window.close(); }
});
