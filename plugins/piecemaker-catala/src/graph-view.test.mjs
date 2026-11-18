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
  globalThis.fetch = async (url, options) => (await fetchMore(url, options)) ?? new Response(JSON.stringify({ pack: { id: 'pack', platform: 'darwin', version: '1.3', proof: true, installedAt: '2026-11-01' }, status: null, programmes, styles: [{ nom: 'Mise en demeure', regle: 'styles/mise-en-demeure.md' }] }));
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


test('shows each rule with its legal basis and documentation errors', async () => {
  const view = await open([program({ verification: { passed: false, checks: [{ name: 'documentation', passed: false, errors: ['demo.catala_fr:9: titre manquant pour cette entrée. Écrivez ## texte court au-dessus.', 'demo.catala_fr:12: règle sans source juridique : placez-la sous un titre ## Article N | LEGIARTI… ou ## Décision | JURITEXT… (CETATEXT, CONSTEXT), suivi de l\'extrait exact entre « ».'] }] } })]);
  try {
    assert.equal(view.container.querySelector('.pmc-explanation').hidden, false);
    view.click(view.container.querySelector('[role=tab][data-mode=written]'));
    assert.equal(view.container.querySelector('.pmc-alert-list'), null);
    assert.equal(view.container.querySelector('.pmc-alerts .pmc-bubble').textContent, '2');
    view.click(view.container.querySelector('[data-alerts]'));
    const alerts = view.container.querySelector('.pmc-alert-list').textContent;
    assert.match(alerts, /Titre manquant.*demo\.catala_fr, ligne 9/);
    assert.match(alerts, /Règle sans source.*demo\.catala_fr, ligne 12/);
    assert.doesNotMatch(alerts, /piecemaker\.|#\[/);
    const asked = [];
    const listen = (event) => asked.push(event.detail);
    window.addEventListener('piecemaker:catala-card-pick', listen);
    view.click(view.container.querySelector('[data-fix]'));
    window.removeEventListener('piecemaker:catala-card-pick', listen);
    assert.equal(asked[0].titre, 'Corriger 2 erreurs');
    assert.match(asked[0].demande, /Titre manquant.*\(demo\.catala_fr, ligne 9\)/);
    assert.equal(view.container.querySelector('.pmc-alert-list'), null);
    const written = view.container.querySelector('.pmc-written');
    assert.equal(written.hidden, false);
    assert.equal(view.container.querySelector('.pmc-bar [data-verify]'), null);
    assert.match(view.container.querySelector('.pmc-run').textContent, /^RédigerVérification2$/);
    view.click(view.container.querySelector('[data-alerts]'));
    assert.match(view.container.querySelector('.pmc-alert-list [data-verify]').textContent, /Recalculer/);
    const card = written.querySelector('[data-card="x002"]');
    assert.equal(card.querySelector('h3').textContent, 'Sanction possible');
    assert.equal(card.querySelector('[data-part="projection"] .pmc-value').textContent, 'Oui');
    assert.match(card.textContent, /Article 1217/);
    assert.match(card.textContent, /Passage juridique fictif/);
    assert.match(card.querySelector('[data-part="justification"]').textContent, /Inexécution/);
    assert.doesNotMatch(view.container.textContent, /typecheck|Contrôles|clerk|test_demo|catleg/i);
    assert.match(written.querySelector('.pmc-thread').textContent, /part des faits/);
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
    view.click(links().find((link) => link.textContent === 'attestation.md'));
    assert.deepEqual(view.opened.at(-1), { path: '/dossier/pieces/attestation.md', passage: { quote: 'Société Exemple SAS n’a pas livré.' } });
    const count = view.opened.length;
    view.click(links().find((link) => link.textContent === 'hors-dossier.md'));
    assert.equal(view.opened.length, count);
    view.click(links().find((link) => link.textContent === 'Décision fictive'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(view.opened.at(-1).path, /\/abcdef0123456789abcdef01$/);
  } finally { view.close(); }
});

test('shows the reference date used for the legal texts, or the day of the check', async () => {
  const catleg = { date_controle: '2026-11-05', passed: true, fichiers: [{ fichier: 'demo.catala_fr', passed: true, messages: [] }] };
  const today = await open([program({ catleg })]);
  try { assert.equal(today.container.querySelector('[data-part="reference-date"]').textContent, 'Droit apprécié au : 5 novembre 2026 (jour du contrôle)'); } finally { today.close(); }
  const past = await open([program({ catleg: { ...catleg, dates_reference: ['2019-12-31'], passed: false, fichiers: [{ fichier: 'demo.catala_fr', passed: false, messages: [] }] } })]);
  try { assert.equal(past.container.querySelector('[data-part="reference-date"]').textContent, 'Droit apprécié au : 31 décembre 2019 vigueur à vérifier'); } finally { past.close(); }
  const none = await open([program({ catleg: null })]);
  try { assert.equal(none.container.querySelector('[data-part="reference-date"]'), null); } finally { none.close(); }
});

test('the graph opens each cited source directly and shows no detail panel', async () => {
  const view = await open([program()]);
  try {
    view.click(view.container.querySelector('[role="tab"][data-mode="graph"]'));
    assert.equal(view.container.querySelector('.pmc-explanation').hidden, false);
    assert.equal(view.container.querySelectorAll('[data-node][data-kind=origin]').length, 0);
    view.click(view.container.querySelector('[data-node="x001"]'));
    assert.equal(view.container.querySelector('.pmc-inspector'), null);
    assert.equal(view.container.querySelector('.pmc-cards'), null);
    assert.equal(view.container.querySelectorAll('.pmc-map .is-selected').length, 1);
    view.click(view.container.querySelector('[data-map-zoom=in]'));
    assert.ok(Number(view.container.querySelector('.pmc-map').dataset.scale) > 1);
    const opened = view.opened.length;
    view.click(view.container.querySelector('[data-node] [data-part=evidence] [data-open-reference][data-kind=piece]'));
    assert.equal(view.opened.length, opened + 1);
    assert.equal(view.opened.at(-1).path, '/dossier/pieces/attestation.md');
    view.click(view.dom.window.document.querySelector('#outside'));
    assert.equal(view.container.querySelectorAll('.is-selected').length, 0);
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
    assert.equal(view.container.querySelector('[data-node="x002"] .pmc-met').textContent, 'Non remplie');
    assert.equal(view.container.querySelector('[data-node="x002"]').dataset.state, 'ko');
    choose('TestErrone');
    assert.match(view.container.querySelector('.pmc-explanation').textContent, /ne produit pas de graphe/);
    assert.equal(view.container.querySelectorAll('[data-node]').length, 0);
    assert.equal(requests, initial);
  } finally { view.close(); }
});

test('shows a native JSON graph when the scenario has no DOT and keeps its provenance out of the map', async () => {
  const position = { file: '/dossier/.piecemaker/catala/demo/demo.catala_fr', start: { line: 9, character: 1 }, end: { line: 9, character: 50 }, law_headings: ['Article 1217'] };
  const provenance = { trace: [{ element: { kind: 'scope_call', name: 'Demo', decl_pos: position }, pos: position, value: {}, trace: [{ element: { kind: 'scope_var', name: 'sanction_possible', output: true, decl_pos: position }, pos: position, value: true, trace: [{ element: { kind: 'exception' }, pos: position, value: true }] }] }], definitions: [], dependencies: [], issues: ['Graphe issu de la trace JSON.'] };
  const view = await open([program({ graphe: '', scenarios: [{ fichier: 'test_demo.catala_fr', scope: 'Test', passed: true, test_reussi: true, graphe: '', message: '', provenance }] })]);
  try {
    assert.ok(view.container.querySelector('[data-node][data-kind="answer"]'));
    assert.doesNotMatch(view.container.querySelector('.pmc-map-summary').textContent, /trace JSON/);
    assert.doesNotMatch(view.container.querySelector('.pmc-map').textContent, /Origine native|Ligne 9/);
  } finally { view.close(); }
});

test('shows the program text with each Catala block drawn as a graph', async () => {
  const view = await open([program()]);
  try {
    view.click(view.container.querySelector('[role="tab"][data-mode="program"]'));
    const panel = view.container.querySelector('.pmc-program');
    assert.equal(panel.hidden, false);
    assert.equal(view.container.querySelector('.pmc-explanation').hidden, true);
    const file = panel.querySelector('.pmc-program-file[data-file="demo.catala_fr"]');
    assert.deepEqual([...file.querySelectorAll(':scope > h3')].map((heading) => heading.textContent), ['Article 1217', 'Pièce 1', 'Hors dossier']);
    assert.match(file.textContent, /Société Exemple SAS n’a pas livré/);
    const graph = file.querySelector('h3 ~ .pmc-program-graph .pmc-map');
    assert.ok(graph.querySelector(':scope > .pmc-branch > [data-node="x002"]'));
    assert.ok(graph.querySelector('.pmc-children [data-node="x001"]'));
    assert.match(file.querySelector('.pmc-program-code code').textContent, /définition sanction_possible/);
  } finally { view.close(); }
});

test('shows the objective above independent branches and repeats shared facts under each', async () => {
  const shared = `digraph G {
  x001 [label=<<table><tr><td>inexécution</td><td>true</td></tr></table>>, URL="https://catala.local/test_demo.catala_fr#L9", style="filled"];
  x002 [label=<<table><tr><td>sanction_possible</td></tr><tr><td>inexécution</td></tr><tr><td>=</td></tr><tr><td>true</td></tr></table>>, URL="https://catala.local/demo.catala_fr#L9", style="filled"];
  x003 [label=<<table><tr><td>autre_sanction</td></tr><tr><td>inexécution</td></tr><tr><td>=</td></tr><tr><td>false</td></tr></table>>, URL="https://catala.local/demo.catala_fr#L9", style="filled"];
  subgraph cluster_inputs { x001; }
  x001 -> x002 [style="solid"];
  x001 -> x003 [style="solid"];
}`;
  const view = await open([program({ graphe: shared })]);
  try {
    view.click(view.container.querySelector('[role="tab"][data-mode="graph"]'));
    const map = view.container.querySelector('.pmc-map');
    assert.equal(map.dataset.layout, 'columns');
    assert.equal(map.querySelectorAll('svg.pmc-wires path').length, map.querySelectorAll('.pmc-children > .pmc-branch').length);
    assert.match(map.querySelector('svg.pmc-wires path').getAttribute('d'), /^M\S+ \S+C/);
    const roots = [...map.querySelectorAll(':scope > .pmc-branch')];
    assert.equal(roots.length, 2);
    const conclusion = roots[0].querySelector(':scope > [data-node]');
    assert.equal(conclusion.dataset.kind, 'answer');
    assert.equal(conclusion.querySelector('.pmc-box-kind').textContent, 'Objectif');
    const child = roots[0].querySelector(':scope > .pmc-children > .pmc-branch > [data-node="x001"]');
    assert.ok(child);
    assert.equal(child.dataset.kind, 'fact');
    assert.equal(map.querySelectorAll('[data-node="x001"]').length, 2);
    assert.ok(roots[1].querySelector(':scope > .pmc-children > .pmc-branch > [data-node="x001"]'));
    assert.equal(roots[1].querySelector(':scope > [data-node]').dataset.state, 'ok');
    assert.equal(conclusion.dataset.state, 'ko');
    assert.deepEqual([...map.querySelectorAll('i[hidden]')].map((edge) => `${edge.dataset.from}>${edge.dataset.to}`).sort(), ['x001>x002', 'x001>x003']);
    view.click(child);
    assert.deepEqual([...map.querySelectorAll('.is-selected')].map((node) => node.dataset.node), ['x001', 'x001']);
  } finally { view.close(); }
});

test('the pick mode sends the clicked card with its file and lines and stops', async () => {
  const { dom, container, click, close } = await open([program()]);
  try {
    const inserted = [];
    const states = [];
    window.addEventListener('piecemaker:catala-card-pick', (event) => inserted.push(event.detail));
    window.addEventListener('piecemaker:panel-pick-state', (event) => states.push(event.detail));
    const picked = [];
    window.addEventListener('piecemaker:panel-picked', (event) => picked.push(event.detail));
    const root = container.querySelector('.pmc');
    const card = container.querySelector('.pmc-map-node[data-kind="fact"]');
    click(card);
    assert.deepEqual(inserted, []);
    click(dom.window.document.querySelector('#outside'));
    window.dispatchEvent(new CustomEvent('piecemaker:panel-pick', { detail: { tab: 'plugin:autre' } }));
    assert.equal(root.hasAttribute('data-picking'), false);
    window.dispatchEvent(new CustomEvent('piecemaker:panel-pick', { detail: { tab: 'plugin:piecemaker-catala' } }));
    assert.equal(root.hasAttribute('data-picking'), true);
    click(container.querySelector('.pmc-map-node[data-kind="fact"] h3'));
    assert.deepEqual(inserted, [{ titre: card.querySelector('h3').textContent, fichier: undefined, debut: undefined, fin: undefined, identifiant: 'inexécution', valeur: 'Vrai', scenario: 'Test' }]);
    assert.deepEqual(picked, [{ tab: 'plugin:piecemaker-catala' }]);
    window.dispatchEvent(new CustomEvent('piecemaker:panel-pick', { detail: { tab: 'plugin:piecemaker-catala' } }));
    const rule = container.querySelector('.pmc-map-node:not([data-kind="fact"])');
    click(rule);
    assert.deepEqual(inserted[1], { titre: rule.querySelector('h3').textContent, fichier: '.piecemaker/catala/demo/demo.catala_fr', debut: 9, fin: 9, identifiant: 'sanction_possible', valeur: 'Vrai', scenario: 'Test' });
    assert.equal(root.hasAttribute('data-picking'), false);
    assert.equal(card.classList.contains('is-selected'), false);
    window.dispatchEvent(new CustomEvent('piecemaker:panel-pick', { detail: { tab: 'plugin:piecemaker-catala' } }));
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(root.hasAttribute('data-picking'), false);
    assert.deepEqual(states.map((state) => state.active), [true, false, true, false, true, false]);
  } finally { close(); }
});

test('keeps one toolbar line and shows the drafted text with its Catala blocks folded', async () => {
  const view = await open([program()]);
  try {
    const bar = view.container.querySelector('.pmc-bar');
    assert.deepEqual([...bar.querySelectorAll('[role=tab]')].map((tab) => tab.textContent.trim().replace(/\s*\d+$/, '')), ['Graphe', 'Raisonnement', 'Programme']);
    assert.equal(view.container.querySelector('[data-refresh]'), null);
    assert.equal(bar.querySelectorAll('[data-map-zoom]').length, 3);
    assert.equal(bar.querySelector('[data-verify]'), null);
    assert.equal(bar.querySelector('[data-alerts] .pmc-bubble'), null);
    view.click(bar.querySelector('[data-alerts]'));
    assert.match(view.container.querySelector('.pmc-alert-list').textContent, /Analysé le.*Recalculer.*Aucune erreur/);
    assert.equal(view.container.querySelector('[data-fix]'), null);
    view.click(view.container.querySelector('[data-alerts]'));
    const sent = [];
    const listen = (event) => sent.push([event.type, event.detail]);
    for (const type of ['piecemaker:panel-new-chat', 'piecemaker:catala-card-pick']) window.addEventListener(type, listen);
    view.click(view.container.querySelector('[data-draft]'));
    assert.deepEqual([...view.container.querySelectorAll('[data-draft-style]')].map((button) => button.textContent), ['Mise en demeure', 'Autre document']);
    view.click(view.container.querySelector('[data-draft-style="0"]'));
    for (const type of ['piecemaker:panel-new-chat', 'piecemaker:catala-card-pick']) window.removeEventListener(type, listen);
    assert.deepEqual(sent.map(([type]) => type), ['piecemaker:panel-new-chat', 'piecemaker:catala-card-pick']);
    assert.equal(sent[1][1].titre, 'Rédiger : Mise en demeure');
    assert.match(sent[1][1].demande, /style-redaction-cabinet.*styles\/mise-en-demeure\.md[\s\S]*Raisonnement :\n- /);
    assert.equal(view.container.querySelector('.pmc-draft-list'), null);
    await new Promise((resolve) => setImmediate(resolve));
  } finally { view.close(); }
});

test('groups the scenarios of a task by reasoning and drafts from every reasoning', async () => {
  const tests = "```catala\n#[test]\ndéclaration champ d'application TestPrincipal:\n  résultat calcul contenu Demo.Principal\n\n#[test]\ndéclaration champ d'application TestSubsidiaire:\n  résultat calcul contenu Demo.Subsidiaire\n```\n";
  const scenarios = ['TestPrincipal', 'TestSubsidiaire'].map((scope) => ({ fichier: 'test_demo.catala_fr', scope, passed: true, test_reussi: true, graphe, message: '' }));
  const tache = { tache: 'Conclusions en défense Dupont / Société Exemple', type: 'litigation', raisonnements: [{ champ: 'Principal', objectif: 'Rejeter la demande', rang: 'À titre principal' }, { champ: 'Subsidiaire', objectif: 'Réduire le montant', rang: 'À titre subsidiaire' }] };
  const base = program();
  const view = await open([{ ...base, tache, scenarios, fichiers: [...base.fichiers, { nom: 'test_demo.catala_fr', chemin: '/dossier/.piecemaker/catala/demo/test_demo.catala_fr', contenu: tests }] }]);
  try {
    const options = (name) => [...view.container.querySelectorAll(`[${name}] option`)].map((option) => option.textContent);
    assert.deepEqual(options('data-part-choice'), ['À titre principal — Rejeter la demande', 'À titre subsidiaire — Réduire le montant']);
    assert.deepEqual(options('data-scenario-choice'), ['Principal — test réussi']);
    assert.match(view.container.querySelector('[data-part=task]').textContent, /Tâche : Conclusions en défense Dupont \/ Société Exemple\s*litigation/);
    const select = view.container.querySelector('[data-part-choice]');
    select.value = 'Subsidiaire';
    select.dispatchEvent(new view.dom.window.Event('change', { bubbles: true }));
    assert.deepEqual(options('data-scenario-choice'), ['Subsidiaire — test réussi']);
    let demande = '';
    const listen = (event) => { demande = event.detail.demande; };
    window.addEventListener('piecemaker:catala-card-pick', listen);
    view.click(view.container.querySelector('[data-draft]'));
    view.click(view.container.querySelector('[data-draft-style="-1"]'));
    window.removeEventListener('piecemaker:catala-card-pick', listen);
    assert.match(demande, /tâche « Conclusions en défense Dupont \/ Société Exemple » \(litigation\)[\s\S]*Raisonnement — À titre principal — Rejeter la demande \(scénario TestPrincipal\) :\n- [\s\S]*Raisonnement — À titre subsidiaire — Réduire le montant \(scénario TestSubsidiaire\) :\n- /);
    await new Promise((resolve) => setImmediate(resolve));
  } finally { view.close(); }
});
