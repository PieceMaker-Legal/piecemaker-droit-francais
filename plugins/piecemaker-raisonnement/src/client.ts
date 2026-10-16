import type { ReasoningSnapshot, ReasoningResult } from '../../../shared/piecemaker-reasoning.js';
import { loadReasoning } from './api.js';
import { STYLES } from './styles.js';

type Context = { theme: 'dark' | 'light'; project: { name: string; path: string } | null };
type Host = { readonly context: Context; onContextChange(callback: (context: Context) => void): () => void; openFileInEditor?(file: string): void };
type GraphNode = { id: string; label: string; kind: string; x: number; y: number; value: string; uncertain: boolean };
type Edge = { from: string; to: string; relation?: string };
const COLORS: Record<string, string> = { law: '#ba9ce9', theory: '#e2a5c6', source: '#6b9fdb', fact: '#68bea3', rule: '#ba9ce9', calculation: '#e5b26b', conclusion: '#e2a5c6', scenario: '#bfa66e', test: '#8c96ad' };
const KINDS: Record<string, string> = { law: 'Droit', theory: 'Théorie', source: 'Source', fact: 'Assertion', rule: 'Règle', calculation: 'Calcul', conclusion: 'Conclusion', scenario: 'Scénario', test: 'Test' };
const STATUS = { known: 'Déduit du modèle', unknown: 'Indéterminé', blocked: 'Bloqué', error: 'Erreur' };
const THEORY_STATUS = { passing: 'Tests du modèle réussis', failing: 'Tests en échec', untested: 'Programme non testé', incomplete: 'Programme incomplet' };
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const display = (result?: ReasoningResult) => result ? result.status === 'known' ? typeof result.value === 'boolean' ? result.value ? 'Vrai' : 'Faux' : String(result.value) : STATUS[result.status] : '';
const cleanups = new WeakMap<HTMLElement, () => void>();

export function mount(container: HTMLElement, api: Host) {
  const style = document.createElement('style');
  style.textContent = STYLES;
  const root = document.createElement('section');
  root.className = 'pmr';
  root.setAttribute('aria-label', 'Programme du dossier');
  root.innerHTML = `<header class="pmr-head"><strong>Programme du dossier</strong><button data-demo>Exemple fictif</button><button data-refresh aria-label="Actualiser le programme">↻</button><select aria-label="Scénario actif" data-scenario><option value="base">Dossier sans hypothèses</option></select></header><div class="pmr-filters"><select data-layer aria-label="Couche du raisonnement"><option value="all">Toutes les couches</option><option value="law">Droit</option><option value="fact">Faits et relations</option><option value="theory">Théorie juridique</option></select><select data-focus aria-label="Conclusion à explorer"><option value="">Toutes les conclusions</option></select></div><div class="pmr-meta"></div><div class="pmr-warning" hidden></div><div class="pmr-canvas" aria-label="Graphe du raisonnement"><svg viewBox="0 0 1000 640" role="group" aria-label="Sources et dépendances"></svg><div class="pmr-empty"><strong>Un dossier qui s’exécute</strong><p>Les sources, assertions et règles proposées dans CITATIONS apparaissent ici à la fin du tour.</p><button data-empty-demo>Explorer l’exemple fictif</button></div><div class="pmr-legend"><span><i style="background:#6b9fdb"></i>Sources</span><span><i style="background:#68bea3"></i>Assertions</span><span><i style="background:#ba9ce9"></i>Règles et résultats</span></div><div class="pmr-tools"><button data-zoom="-1" aria-label="Dézoomer">−</button><button data-zoom="1" aria-label="Zoomer">+</button><button data-center>Centrer</button></div></div><div class="pmr-inspector"><div class="pmr-tabs" role="tablist" aria-label="Exploration du programme"><button role="tab" data-tab="summary" aria-selected="true">Théories</button><button role="tab" data-tab="details">Détails</button><button role="tab" data-tab="scenarios">Scénarios</button><button role="tab" data-tab="tests">Tests</button><button role="tab" data-tab="code">Programme</button></div><div class="pmr-detail"><small>Sélectionnez un nœud pour voir sa définition, ses sources et ses dépendances.</small></div></div>`;
  container.replaceChildren(style, root);
  const canvas = root.querySelector<HTMLElement>('.pmr-canvas')!;
  const svg = root.querySelector<SVGSVGElement>('svg')!;
  const detail = root.querySelector<HTMLElement>('.pmr-detail')!;
  let snapshot: ReasoningSnapshot | null = null;
  let context = api.context;
  let scenario = 'base';
  let selected = '';
  let tab = 'summary';
  let layer = 'all';
  let focus = '';
  let nodes: GraphNode[] = [];
  let edges: Edge[] = [];
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  let drag: { id: string; x: number; y: number; moved: boolean } | null = null;
  let stopped = false;
  let sequence = 0;
  let timer = 0;
  let lastSerialized = '';

  const active = () => snapshot?.evaluations.find((evaluation) => evaluation.scenario === scenario);
  const result = (id: string) => active()?.results.find((entry) => entry.id === id);
  const references = (value: unknown): string[] => {
    if (!value || typeof value !== 'object') return [];
    const expression = value as { ref?: string; args?: unknown[]; apply?: string; bindings?: Record<string, unknown>; at?: unknown };
    return expression.ref ? [expression.ref] : expression.apply ? [expression.apply, ...Object.values(expression.bindings ?? {}).flatMap(references), ...references(expression.at)] : (expression.args ?? []).flatMap(references);
  };
  const paintGraph = () => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const neighbours = new Set([selected, ...edges.filter((edge) => edge.from === selected || edge.to === selected).flatMap((edge) => [edge.from, edge.to])]);
    svg.innerHTML = `<defs><marker id="pmr-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill="currentColor"/></marker></defs><g transform="translate(${500 + pan.x} ${320 + pan.y}) scale(${zoom})">${edges.map((edge) => {
      const a = byId.get(edge.from), b = byId.get(edge.to);
      if (!a || !b) return '';
      const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const gap = b.kind === 'source' || b.kind === 'test' ? 15 : 20;
      return `<line marker-end="url(#pmr-arrow)" class="pmr-edge ${edge.relation === 'contradicts' ? 'is-conflict' : ''} ${selected && (edge.from === selected || edge.to === selected) ? 'is-neighbour' : ''}" x1="${a.x}" y1="${a.y}" x2="${b.x - (b.x - a.x) / distance * gap}" y2="${b.y - (b.y - a.y) / distance * gap}"><title>${escape(edge.relation ?? 'dépendance')}</title></line>`;
    }).join('')}${nodes.map((node) => `<g class="pmr-node ${selected === node.id ? 'is-selected' : ''} ${selected && !neighbours.has(node.id) ? 'is-dim' : ''} ${node.uncertain ? 'is-uncertain' : ''}" data-node="${escape(node.id)}" transform="translate(${node.x} ${node.y})" tabindex="0" role="button" aria-label="${escape(`${KINDS[node.kind]} : ${node.label}, ${node.value}`)}"><circle r="${node.kind === 'source' || node.kind === 'test' ? 10 : 15}" fill="${COLORS[node.kind] ?? '#aaa'}"/><text transform="scale(${1 / zoom})" x="22" y="-2">${escape(node.label.length > 37 ? `${node.label.slice(0, 35)}…` : node.label)}</text><text transform="scale(${1 / zoom})" class="pmr-value" x="22" y="14">${escape(node.value)}</text><title>${escape(`${node.label}\n${node.value}`)}</title></g>`).join('')}</g>`;
  };
  const fitGraph = () => {
    if (!nodes.length) { zoom = 1; pan = { x: 0, y: 0 }; return; }
    const minX = Math.min(...nodes.map((node) => node.x));
    const maxX = Math.max(...nodes.map((node) => node.x));
    const minY = Math.min(...nodes.map((node) => node.y));
    const maxY = Math.max(...nodes.map((node) => node.y));
    zoom = Math.min(1, 650 / Math.max(1, maxX - minX), 490 / Math.max(1, maxY - minY));
    pan = { x: -(minX + maxX) / 2 * zoom - 95, y: -(minY + maxY) / 2 * zoom };
  };
  const buildGraph = () => {
    if (!snapshot) return;
    const old = new Map(nodes.map((node) => [node.id, node]));
    nodes = [];
    edges = [];
    const add = (id: string, label: string, kind: string, value = '', uncertain = false) => {
      const previous = old.get(id);
      const index = nodes.length;
      nodes.push({ id, label, kind, value, uncertain, x: previous?.x ?? Math.cos(index * 2.399) * (80 + index * 9), y: previous?.y ?? Math.sin(index * 2.399) * (80 + index * 9) });
    };
    snapshot.program.sources.forEach((source) => add(source.id, source.title, 'source', source.stale ? 'Version remplacée' : source.repaired ? 'Extrait recalé' : source.verified ? 'Extrait vérifié' : 'Non vérifié', source.stale || source.repaired || !source.verified));
    snapshot.program.nodes.forEach((node) => {
      const evaluated = result(node.id);
      add(node.id, node.label, node.layer === 'law' ? 'law' : node.layer === 'theory' ? 'theory' : node.kind, node.layer === 'law' && evaluated?.status === 'unknown' ? 'Définition datée à appliquer' : display(evaluated), evaluated?.status === 'blocked' || evaluated?.status === 'error' || (node.layer !== 'law' && evaluated?.status !== 'known'));
      node.sources.forEach((source) => edges.push({ from: source, to: node.id }));
      references(node.expression).forEach((ref) => edges.push({ from: ref, to: node.id }));
    });
    snapshot.program.scenarios.forEach((entry) => {
      add(`scenario:${entry.id}`, entry.label, 'scenario', entry.id === scenario ? 'Scénario actif' : 'Hypothèses explicites');
      Object.keys(entry.assumptions).forEach((ref) => edges.push({ from: `scenario:${entry.id}`, to: ref }));
    });
    snapshot.program.tests.forEach((entry) => {
      const test = snapshot?.evaluations.flatMap((evaluation) => evaluation.tests).find((test) => test.id === entry.id);
      add(`test:${entry.id}`, entry.label, 'test', test?.passed ? 'Réussi' : 'Échec', !test?.passed);
      edges.push({ from: entry.target, to: `test:${entry.id}` });
    });
    (snapshot.program.links ?? []).forEach((link) => edges.push({ from: link.from, to: link.to, relation: link.relation }));
    const included = new Set<string>();
    if (focus) {
      included.add(focus);
      for (let count = 0; count < snapshot.program.nodes.length + 1; count++) {
        const before = included.size;
        edges.filter((edge) => included.has(edge.to) || (edge.relation === 'contradicts' && included.has(edge.from))).forEach((edge) => { included.add(edge.from); included.add(edge.to); });
        if (included.size === before) break;
      }
    }
    const linked = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
    nodes = nodes.filter((node) => (!focus || included.has(node.id)) && (node.kind !== 'source' || !snapshot!.program.nodes.length || linked.has(node.id)) && (layer === 'all' || (layer === 'law' ? node.kind === 'law' : layer === 'theory' ? node.kind === 'theory' || node.kind === 'conclusion' || node.kind === 'calculation' : node.kind === 'fact')));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (let step = 0; step < 100 && nodes.length <= 300; step++) {
      const forces = new Map(nodes.map((node) => [node.id, { x: -node.x * .009, y: -node.y * .009 }]));
      for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
        const dx = nodes[a].x - nodes[b].x, dy = nodes[a].y - nodes[b].y;
        const distance = Math.max(30, Math.hypot(dx, dy));
        const force = 900 / (distance * distance);
        forces.get(nodes[a].id)!.x += dx * force;
        forces.get(nodes[a].id)!.y += dy * force;
        forces.get(nodes[b].id)!.x -= dx * force;
        forces.get(nodes[b].id)!.y -= dy * force;
      }
      for (const edge of edges) {
        const a = byId.get(edge.from), b = byId.get(edge.to);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy));
        const force = (distance - 155) * .012;
        forces.get(a.id)!.x += dx / distance * force;
        forces.get(a.id)!.y += dy / distance * force;
        forces.get(b.id)!.x -= dx / distance * force;
        forces.get(b.id)!.y -= dy / distance * force;
      }
      nodes.forEach((node) => { node.x += forces.get(node.id)!.x; node.y += forces.get(node.id)!.y; });
    }
    if (nodes.some((node) => !old.has(node.id))) fitGraph();
    paintGraph();
  };
  const paintDetails = () => {
    root.querySelectorAll<HTMLElement>('[data-tab]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.tab === tab)));
    if (!snapshot) return;
    if (tab === 'summary') {
      const propositions = snapshot.program.nodes;
      const rows = (active()?.results ?? []).filter((row) => !propositions.some((node) => node.id === row.id && node.layer === 'law'));
      const theories = propositions.filter((node) => node.layer === 'theory' || (node.layer === undefined && node.kind !== 'fact'));
      detail.innerHTML = `${(snapshot.theories ?? []).map((theory) => `<article class="pmr-theory"><h3>${escape(theory.label)}</h3><strong class="${theory.status === 'passing' ? 'pmr-pass' : 'pmr-fail'}">${escape(THEORY_STATUS[theory.status])}</strong><p>Résultat : ${escape(display(result(theory.id)))}</p><p>Entrées factuelles : ${theory.facts.map((id) => `<button data-select="${escape(id)}">${escape(snapshot!.program.nodes.find((node) => node.id === id)?.label ?? id)}</button>`).join(' ')}</p><p>Droit appliqué : ${theory.laws.map((id) => `<button data-select="${escape(id)}">${escape(snapshot!.program.nodes.find((node) => node.id === id)?.label ?? id)}</button>`).join(' ')}</p><p>${theory.tests.length} tests · <button data-program="${escape(theory.id)}">Voir le programme</button> <button data-theory-tests="${escape(theory.id)}">Voir les tests</button></p>${theory.issues.map((issue) => `<p class="pmr-fail">${escape(issue)}</p>`).join('')}</article>`).join('')}<h3>${propositions.length ? 'État du raisonnement' : 'Sources collectées · raisonnement non formalisé'}</h3><p>${propositions.filter((node) => node.layer === 'law').length} règles de droit · ${propositions.filter((node) => node.kind === 'fact').length} faits et relations · ${theories.length} propositions de théorie</p><p>${rows.filter((row) => row.status === 'known').length} valeurs déduites du modèle · ${rows.filter((row) => row.status === 'blocked').length} bloquées · ${rows.filter((row) => row.status === 'unknown').length} indéterminées</p>${!propositions.length ? '<p>Aucune conclusion exécutée, aucun test. Demandez une analyse du dossier pour formaliser les propositions décisives.</p>' : ''}<small>La correspondance textuelle des extraits ne certifie ni leur valeur probatoire ni la traduction du droit.</small>${theories.map((node) => `<p><button data-select="${escape(node.id)}">${escape(node.label)}</button> · ${escape(display(result(node.id)))}</p>`).join('')}${(snapshot.conflicts ?? []).map((conflict) => `<div class="pmr-change pmr-fail">${escape(conflict.message)}<br>${conflict.nodes.map((id) => `<button data-select="${escape(id)}">${escape(snapshot!.program.nodes.find((node) => node.id === id)?.label ?? id)}</button>`).join(' ')}</div>`).join('')}${snapshot.diagnostics.map((diagnostic) => `<p class="pmr-fail">${escape(diagnostic)}</p>`).join('')}`;
      return;
    }
    if (tab === 'code') {
      detail.innerHTML = `<h3>Programme exécutable${selected ? ` · ${escape(selected)}` : ''}</h3><small>Les règles paramétrées associent les entrées factuelles à une conclusion datée. Les tests vérifient les résultats attendus et les cas bloquants.</small><pre>${escape(JSON.stringify({ entrypoint: selected || focus || snapshot.theories?.[0]?.id || null, ...snapshot.program }, null, 2))}</pre>`;
      return;
    }
    if (tab === 'tests') {
      const tests = snapshot.evaluations.flatMap((evaluation) => evaluation.tests.filter((test) => !focus || test.actual.id === focus).map((test) => ({ ...test, scenario: evaluation.scenario })));
      detail.innerHTML = `<small>Tests du modèle proposé. Leur réussite ne certifie pas la vérité des faits ou l'interprétation du droit.</small>${tests.length ? `<table><thead><tr><th>Test</th><th>Scénario</th><th>Résultat</th></tr></thead><tbody>${tests.map((test) => `<tr><td>${escape(test.label)}<br><small>${escape(snapshot!.program.tests.find((entry) => entry.id === test.id)?.rationale ?? 'Origine de l’attente non précisée')}</small></td><td>${escape(test.scenario)}</td><td class="${test.passed ? 'pmr-pass' : 'pmr-fail'}">${test.passed ? '✓ Réussi' : '✕ Échec'}<br>${escape(display(test.actual))}${test.passed ? '' : `<br>Attendu : ${escape(JSON.stringify(test.expected))}`}</td></tr>`).join('')}</tbody></table>` : '<p>Aucun test formalisé.</p>'}`;
      return;
    }
    if (tab === 'scenarios') {
      detail.innerHTML = `<small>Les hypothèses ne modifient jamais le dossier de base.</small><table><thead><tr><th>Proposition</th>${snapshot.evaluations.map((evaluation) => `<th>${escape(snapshot?.program.scenarios.find((entry) => entry.id === evaluation.scenario)?.label ?? 'Sans hypothèses')}</th>`).join('')}</tr></thead><tbody>${snapshot.program.nodes.filter((node) => node.kind !== 'fact').map((node) => `<tr><td>${escape(node.label)}</td>${snapshot!.evaluations.map((evaluation) => `<td>${escape(display(evaluation.results.find((entry) => entry.id === node.id)))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      return;
    }
    const node = snapshot.program.nodes.find((entry) => entry.id === selected);
    const source = snapshot.program.sources.find((entry) => entry.id === selected);
    const scenarioNode = snapshot.program.scenarios.find((entry) => `scenario:${entry.id}` === selected);
    const testNode = snapshot.program.tests.find((entry) => `test:${entry.id}` === selected);
    if (source) detail.innerHTML = `<h3>${escape(source.title)}</h3><small>${source.stale ? 'Source remplacée' : source.repaired ? 'Passage recalé : interprétation à réexaminer' : source.verified ? 'Correspondance textuelle vérifiée' : 'Extrait non vérifié'}</small>${source.nature === 'simulation' ? '<p class="pmr-fail">Document de simulation</p>' : ''}${source.validity ? `<p>Version du ${escape(source.validity.from)} au ${escape(source.validity.to ?? 'terme non fixé')} (fin exclusive)</p>` : source.nature === 'article' ? '<p class="pmr-fail">Période de validité inconnue</p>' : ''}<blockquote>${escape(source.excerpt)}</blockquote>${source.proposedExcerpt ? `<details><summary>Extrait initial proposé par l’agent</summary><blockquote>${escape(source.proposedExcerpt)}</blockquote></details>` : ''}${source.token ? '<button data-source>Ouvrir la citation</button>' : '<small>Source fictive de démonstration.</small>'}`;
    else if (node) {
      const evaluated = result(node.id);
      detail.innerHTML = `<small>${escape(node.layer === 'law' ? 'Droit' : node.layer === 'fact' ? 'Fait / relation' : node.layer === 'theory' ? 'Théorie juridique' : KINDS[node.kind])} · ${escape(node.id)}</small><h3>${escape(node.label)}</h3><p><strong>${escape(node.layer === 'law' && evaluated?.status === 'unknown' ? 'Définition paramétrée à appliquer' : display(evaluated))}</strong>${evaluated?.assumptions.length ? ' · sous hypothèses' : ''}</p>${node.validity ? `<p>Version applicable : ${escape(node.validity.from)} → ${escape(node.validity.to ?? 'fin non fixée')} (fin exclusive)</p>` : ''}${node.relation ? `<p>${escape(node.relation.subject)} → ${escape(node.relation.predicate)} → ${escape(node.relation.object)}</p><small>Contexte : ${escape(node.relation.context)} · fait : ${escape(node.relation.eventDate ?? 'date inconnue')} · document : ${escape(node.relation.documentDate ?? 'date inconnue')}</small>` : ''}${node.rationale ? `<p>${escape(node.rationale)}</p>` : ''}${node.state === 'disputed' ? '<p class="pmr-fail">Assertion contestée : choisir un scénario pour explorer les variantes.</p>' : ''}${evaluated?.missing.length ? `<p>À déterminer : ${evaluated.missing.filter(Boolean).map((id) => `<span class="pmr-chip">${escape(id)}</span>`).join('')}</p>` : ''}${evaluated?.assumptions.length ? `<p>Hypothèses : ${evaluated.assumptions.map((id) => `<span class="pmr-chip">${escape(id)}</span>`).join('')}</p>` : ''}${(evaluated?.issues ?? []).map((issue) => `<p class="pmr-fail">${escape(issue)}</p>`).join('')}${node.sources.map((id) => { const item = snapshot!.program.sources.find((source) => source.id === id); return `<p><button data-select="${escape(id)}">${escape(item?.title ?? id)}</button></p>`; }).join('')}<details><summary>Définition et dépendances</summary><pre>${escape(JSON.stringify({ definition: node, evaluation: evaluated }, null, 2))}</pre></details>`;
    } else if (scenarioNode) detail.innerHTML = `<h3>${escape(scenarioNode.label)}</h3><p>Hypothèses explicites, distinctes des assertions sourcées.</p><pre>${escape(JSON.stringify(scenarioNode.assumptions, null, 2))}</pre><button data-use-scenario="${escape(scenarioNode.id)}">Explorer ce scénario</button>`;
    else if (testNode) detail.innerHTML = `<h3>${escape(testNode.label)}</h3><pre>${escape(JSON.stringify(testNode, null, 2))}</pre><button data-show-tests>Voir les résultats des tests</button>`;
    else detail.innerHTML = '<small>Sélectionnez un nœud : source, assertion, règle, scénario ou test. Faites glisser le fond pour déplacer le graphe.</small>';
    if (snapshot.changes.length) detail.innerHTML += `<details><summary>${snapshot.changes.length} résultat(s) modifié(s) au dernier tour</summary>${snapshot.changes.map((change) => `<div class="pmr-change"><strong>${escape(change.id)} · ${escape(change.scenario)}</strong><pre>${escape(change.before)} → ${escape(change.after)}</pre></div>`).join('')}</details>`;
  };
  const paint = () => {
    root.dataset.theme = context.theme;
    if (!snapshot) return;
    const select = root.querySelector<HTMLSelectElement>('[data-scenario]')!;
    select.innerHTML = `<option value="base">Dossier sans hypothèses</option>${snapshot.program.scenarios.map((entry) => `<option value="${escape(entry.id)}">${escape(entry.label)}</option>`).join('')}`;
    if (!snapshot.evaluations.some((entry) => entry.scenario === scenario)) scenario = 'base';
    select.value = scenario;
    const meta = root.querySelector<HTMLElement>('.pmr-meta')!;
    meta.dataset.demo = String(Boolean(snapshot.demo));
    const focusSelect = root.querySelector<HTMLSelectElement>('[data-focus]')!;
    focusSelect.innerHTML = '<option value="">Toutes les conclusions</option>' + snapshot.program.nodes.filter((node) => node.kind === 'conclusion').map((node) => `<option value="${escape(node.id)}">${escape(node.label)}</option>`).join('');
    if (focus && !snapshot.program.nodes.some((node) => node.id === focus)) focus = '';
    focusSelect.value = focus;
    meta.textContent = snapshot.demo ? 'EXEMPLE FICTIF · non enregistré dans le dossier · montants en centimes' : snapshot.program.nodes.length ? `Révision ${snapshot.revision} · ${snapshot.program.nodes.length} propositions · ${snapshot.program.sources.length} extraits · ${(snapshot.conflicts ?? []).length} conflits potentiels` : `${snapshot.program.sources.length} extraits · sources collectées, raisonnement non formalisé`;
    const warning = root.querySelector<HTMLElement>('.pmr-warning')!;
    const warnings = [...snapshot.diagnostics, ...(snapshot.conflicts?.length ? [`${snapshot.conflicts.length} conflit(s) potentiel(s) : voir le bilan.`] : [])];
    warning.hidden = !warnings.length;
    warning.textContent = warnings.join(' · ');
    root.querySelector<HTMLElement>('.pmr-empty')!.hidden = Boolean(snapshot.program.nodes.length || snapshot.program.sources.length);
    root.querySelector<HTMLElement>('[data-demo]')!.textContent = snapshot.demo ? 'Revenir au dossier' : 'Exemple fictif';
    buildGraph();
    paintDetails();
  };
  const load = async (example = false) => {
    const request = ++sequence;
    try {
      if (!example && !context.project) return;
      const data = await loadReasoning(context.project?.path ?? null, example);
      if (stopped || request !== sequence) return;
      const serialized = JSON.stringify(data);
      if (serialized === lastSerialized) return;
      lastSerialized = serialized;
      snapshot = data;
      paint();
    } catch (error) {
      if (stopped || request !== sequence) return;
      const warning = root.querySelector<HTMLElement>('.pmr-warning')!;
      warning.hidden = false;
      warning.textContent = error instanceof Error ? error.message : 'Chargement impossible.';
    }
  };
  const selectNode = (id: string) => { selected = id; tab = 'details'; paintGraph(); paintDetails(); };
  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('button');
    if (!button) return;
    if (button.hasAttribute('data-demo')) { lastSerialized = ''; void load(!snapshot?.demo); }
    if (button.hasAttribute('data-empty-demo')) void load(true);
    if (button.hasAttribute('data-refresh')) { lastSerialized = ''; void load(Boolean(snapshot?.demo)); }
    if (button.dataset.tab) { tab = button.dataset.tab; paintDetails(); }
    if (button.dataset.program) { selected = button.dataset.program; tab = 'code'; paintDetails(); }
    if (button.dataset.theoryTests) { focus = button.dataset.theoryTests; tab = 'tests'; paint(); }
    if (button.dataset.select) selectNode(button.dataset.select);
    if (button.dataset.useScenario) { scenario = button.dataset.useScenario; paint(); }
    if (button.hasAttribute('data-show-tests')) { tab = 'tests'; paintDetails(); }
    if (button.hasAttribute('data-source')) {
      const source = snapshot?.program.sources.find((entry) => entry.id === selected);
      if (source?.token) api.openFileInEditor?.(`piecemaker://citation/${source.token}/${encodeURIComponent(source.title)}`);
    }
    if (button.dataset.zoom) { zoom = Math.max(.05, Math.min(3, zoom * (Number(button.dataset.zoom) > 0 ? 1.2 : 1 / 1.2))); paintGraph(); }
    if (button.hasAttribute('data-center')) {
      fitGraph();
      paintGraph();
    }
  });
  root.querySelector('[data-scenario]')!.addEventListener('change', (event) => { scenario = (event.target as HTMLSelectElement).value; paint(); });
  root.querySelector('[data-layer]')!.addEventListener('change', (event) => { layer = (event.target as HTMLSelectElement).value; buildGraph(); fitGraph(); paintGraph(); });
  root.querySelector('[data-focus]')!.addEventListener('change', (event) => { focus = (event.target as HTMLSelectElement).value; buildGraph(); fitGraph(); paintGraph(); });
  svg.addEventListener('click', (event) => {
    if (event.detail === 0) {
      const id = (event.target as Element).closest<HTMLElement>('[data-node]')?.dataset.node;
      if (id) selectNode(id);
    }
  });
  const point = (event: PointerEvent) => {
    const transform = svg.getScreenCTM();
    return transform ? new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse()) : { x: event.clientX, y: event.clientY };
  };
  canvas.addEventListener('pointerdown', (event) => {
    if ((event.target as Element).closest('button') || event.button !== 0) return;
    const position = point(event);
    drag = { id: (event.target as Element).closest<HTMLElement>('[data-node]')?.dataset.node ?? '', x: position.x, y: position.y, moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const position = point(event), dx = position.x - drag.x, dy = position.y - drag.y;
    if (Math.hypot(dx, dy) > 2) drag.moved = true;
    const node = nodes.find((entry) => entry.id === drag!.id);
    if (node) { node.x += dx / zoom; node.y += dy / zoom; }
    else { pan.x += dx; pan.y += dy; }
    drag.x = position.x; drag.y = position.y;
    paintGraph();
  });
  canvas.addEventListener('pointerup', (event) => {
    if (drag?.id && !drag.moved) selectNode(drag.id);
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  svg.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      const id = (event.target as Element).closest<HTMLElement>('[data-node]')?.dataset.node;
      if (id) { event.preventDefault(); selectNode(id); }
    }
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoom = Math.max(.05, Math.min(3, zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
    paintGraph();
  }, { passive: false });
  const unsubscribe = api.onContextChange((next) => {
    const changed = next.project?.path !== context.project?.path;
    context = next;
    root.dataset.theme = next.theme;
    if (changed) { sequence++; snapshot = null; lastSerialized = ''; selected = ''; scenario = 'base'; focus = ''; layer = 'all'; tab = 'summary'; root.querySelector<HTMLSelectElement>('[data-layer]')!.value = layer; nodes = []; edges = []; svg.innerHTML = ''; detail.textContent = ''; void load(); }
  });
  const poll = () => { if (!stopped) { if (!snapshot?.demo) void load(); timer = window.setTimeout(poll, 2500); } };
  root.dataset.theme = context.theme;
  void load();
  timer = window.setTimeout(poll, 2500);
  window.dispatchEvent(new CustomEvent('piecemaker:panel-focus', { detail: { tab: 'plugin:piecemaker-raisonnement' } }));
  cleanups.set(container, () => { stopped = true; sequence++; window.clearTimeout(timer); unsubscribe(); container.replaceChildren(); });
}

export function unmount(container: HTMLElement) {
  cleanups.get(container)?.();
  cleanups.delete(container);
}
