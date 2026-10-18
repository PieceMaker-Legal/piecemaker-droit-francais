import type { ReasoningIssue, ReasoningSnapshot } from '../../../shared/piecemaker-reasoning.js';
import { dismissIssue, loadReasoning, ratePiece, verifyReasoning } from './api.js';
import { STYLES } from './styles.js';

type Context = { theme: 'dark' | 'light'; project: { name: string; path: string } | null };
type Host = { readonly context: Context; onContextChange(callback: (context: Context) => void): () => void; openFileInEditor?(file: string): void };
type Tab = 'detail' | 'alertes' | 'code';
type Json = Record<string, any>;
type Occurrence = { path: string; parent: string; link: 'si' | 'sauf' | 'l_une'; condition: Json };
type GraphNode = { id: string; label: string; status: string; kind: 'question' | 'terme' | 'fait'; decisive: boolean; x: number; y: number };
type Edge = { from: string; to: string; link: Occurrence['link'] };

const RESERVED = new Set(['bilan', 'questions', 'essais']);
const COLORS: Record<string, string> = { acquis: '#68bea3', exclu: '#e08a8a', 'à établir': '#e0b354', contesté: '#ba9ce9', question: '#e2a5c6' };
const TONE: Record<string, string> = { acquis: 'ok', exclu: 'ko', 'à établir': 'warn', contesté: 'warn' };
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const human = (name: string) => { const text = name.replace(/_/g, ' '); return text.charAt(0).toUpperCase() + text.slice(1); };
const shorten = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);
const pill = (status: string, label = status) => `<span class="pmr-pill pmr-${TONE[status] ?? 'muted'}">${escape(label)}</span>`;
const date = (value: unknown) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : 'toujours en vigueur');
const cleanups = new WeakMap<HTMLElement, () => void>();

export function mount(container: HTMLElement, api: Host) {
  const style = document.createElement('style');
  style.textContent = STYLES;
  const root = document.createElement('section');
  root.className = 'pmr piecemaker-ui';
  root.setAttribute('aria-label', 'Raisonnement du dossier');
  root.innerHTML = `<header class="pmr-head"><strong>Raisonnement</strong><select data-scope aria-label="Question" hidden></select><button data-verify class="pmr-primary">Vérifier</button><button data-demo>Exemple fictif</button><button data-refresh aria-label="Actualiser">↻</button></header><div class="pmr-meta"></div><div class="pmr-warning" hidden></div><div class="pmr-workspace"><div class="pmr-canvas" aria-label="Graphe du raisonnement"><svg role="group" aria-label="Question, termes et faits"></svg><div class="pmr-empty" hidden></div><div class="pmr-legend">${Object.entries(COLORS).filter(([key]) => key !== 'question').map(([key, color]) => `<span><i style="background:${color}"></i>${escape(human(key))}</span>`).join('')}<span>— si · - - sauf</span></div><div class="pmr-tools"><button data-zoom="-1" aria-label="Dézoomer">−</button><button data-zoom="1" aria-label="Zoomer">+</button><button data-center>Centrer</button></div></div><div class="pmr-inspector"><div class="pmr-tabs" role="tablist"><button role="tab" data-tab="detail">Détail</button><button role="tab" data-tab="alertes">Alertes<span class="pmr-count" data-alerts hidden></span></button><button role="tab" data-tab="code">Code</button></div><div class="pmr-detail"></div></div></div>`;
  container.replaceChildren(style, root);
  const canvas = root.querySelector<HTMLElement>('.pmr-canvas')!;
  const svg = root.querySelector<SVGSVGElement>('svg')!;
  const detail = root.querySelector<HTMLElement>('.pmr-detail')!;
  const warning = root.querySelector<HTMLElement>('.pmr-warning')!;
  const empty = root.querySelector<HTMLElement>('.pmr-empty')!;
  const picker = root.querySelector<HTMLSelectElement>('[data-scope]')!;
  const meta = root.querySelector<HTMLElement>('.pmr-meta')!;
  let context = api.context;
  let snapshot: ReasoningSnapshot | null = null;
  let serialized = '';
  let tab: Tab = 'detail';
  let scope = 0;
  let selected = '';
  let nodes: GraphNode[] = [];
  let edges: Edge[] = [];
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  let drag: { id: string; x: number; y: number; moved: boolean } | null = null;
  let busy = false;
  let stopped = false;
  let timer = 0;
  let sequence = 0;

  const annotated = () => (snapshot?.annotated ?? null) as Json | null;
  const questions = () => (Array.isArray(annotated()?.questions) ? annotated()!.questions as Json[] : []);
  const terms = () => Object.fromEntries(Object.entries(annotated() ?? {}).filter(([key, value]) => !RESERVED.has(key) && value && typeof value === 'object' && !Array.isArray(value))) as Record<string, Json>;
  const occurrences = (): Occurrence[] => {
    const found: Occurrence[] = [];
    const walk = (condition: Json, at: string, parent: string, link: Occurrence['link']) => {
      if (Array.isArray(condition.l_une)) condition.l_une.forEach((member: Json, index: number) => walk(member, `${at}.l_une[${index}]`, parent, 'l_une'));
      else found.push({ path: at, parent, link, condition });
    };
    for (const [name, term] of Object.entries(terms())) for (const link of ['si', 'sauf'] as const) (term[link] ?? []).forEach((condition: Json, index: number) => walk(condition, `${name}.${link}[${index}]`, name, link));
    return found;
  };
  const groups = (): Array<{ path: string; parent: string; condition: Json }> => {
    const found: Array<{ path: string; parent: string; condition: Json }> = [];
    for (const [name, term] of Object.entries(terms())) for (const link of ['si', 'sauf'] as const) (term[link] ?? []).forEach((condition: Json, index: number) => found.push({ path: `${name}.${link}[${index}]`, parent: name, condition }));
    return found;
  };
  const issuesOf = (paths: string[]) => (snapshot?.issues ?? []).filter((issue) => paths.some((at) => issue.path === at || issue.path.startsWith(`${at}.`) || issue.path.startsWith(`${at}[`)));
  const dismissedIds = () => new Set((snapshot?.dismissed ?? []).map((entry) => entry.id));
  const visibleIssues = () => (snapshot?.issues ?? []).filter((issue) => !dismissedIds().has(issue.id));

  const size = () => ({ width: Math.max(320, canvas.clientWidth), height: Math.max(240, canvas.clientHeight) });
  const radius = (node: GraphNode) => (node.kind === 'question' ? 19 : node.kind === 'terme' ? 15 : 11);
  const branch = (id: string) => {
    const found = new Set([id]);
    const walk = (current: string, up: boolean) => { for (const edge of edges) { const [from, to] = up ? [edge.to, edge.from] : [edge.from, edge.to]; if (from === current && !found.has(to)) { found.add(to); walk(to, up); } } };
    walk(id, true);
    walk(id, false);
    return found;
  };

  const paintGraph = () => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const members = selected ? branch(selected) : null;
    const { width, height } = size();
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.innerHTML = `<g transform="translate(${width / 2 + pan.x} ${height / 2 + pan.y}) scale(${zoom})">${edges.map((edge) => {
      const a = byId.get(edge.from), b = byId.get(edge.to);
      if (!a || !b) return '';
      const lit = members?.has(edge.from) && members.has(edge.to);
      const label = edge.link === 'si' ? '' : edge.link === 'sauf' ? 'sauf' : "l'une";
      return `<path class="pmr-edge${edge.link === 'sauf' ? ' is-sauf' : ''}${lit ? ' is-neighbour' : ''}${members && !lit ? ' is-dim' : ''}" d="M${a.x} ${a.y - radius(a)} C${a.x} ${(a.y + b.y) / 2} ${b.x} ${(a.y + b.y) / 2} ${b.x} ${b.y + radius(b)}"/>${label ? `<text class="pmr-edge-label" x="${(a.x + b.x) / 2 + 4}" y="${(a.y + b.y) / 2}">${label}</text>` : ''}`;
    }).join('')}${nodes.map((node) => `<g class="pmr-node${selected === node.id ? ' is-selected' : ''}${members && !members.has(node.id) ? ' is-dim' : ''}${node.decisive ? ' is-decisive' : ''}" data-node="${escape(node.id)}" transform="translate(${node.x} ${node.y})" tabindex="0" role="button" aria-label="${escape(`${node.label}, ${node.status}`)}"><circle r="${radius(node)}" fill="${COLORS[node.kind === 'question' ? 'question' : node.status] ?? COLORS['à établir']}"/><text text-anchor="middle" y="${radius(node) + 15}"${node.kind === 'question' ? ' class="pmr-strong"' : ''}>${escape(shorten(node.label, 34))}</text><text text-anchor="middle" class="pmr-value" y="${radius(node) + 29}">${escape(node.decisive ? `${node.status} · décisif` : node.status)}</text><title>${escape(`${node.label}\n${node.status}`)}</title></g>`).join('')}</g>`;
  };

  const fitGraph = () => {
    if (!nodes.length) { zoom = 1; pan = { x: 0, y: 0 }; return; }
    const minX = Math.min(...nodes.map((node) => node.x)) - 90, maxX = Math.max(...nodes.map((node) => node.x)) + 90;
    const minY = Math.min(...nodes.map((node) => node.y)) - 30, maxY = Math.max(...nodes.map((node) => node.y)) + 50;
    const { width, height } = size();
    zoom = Math.min(1.2, (width - 24) / Math.max(1, maxX - minX), (height - 70) / Math.max(1, maxY - minY));
    pan = { x: -(minX + maxX) / 2 * zoom, y: -(minY + maxY) / 2 * zoom - 18 };
  };

  const buildGraph = () => {
    const old = new Map(nodes.map((node) => [node.id, node]));
    nodes = [];
    edges = [];
    const question = questions()[scope];
    if (!question) { paintGraph(); return; }
    const all = terms();
    const list = occurrences();
    const levels = new Map<string, number>();
    const order: string[] = [];
    const visit = (name: string, level: number) => {
      if ((levels.get(name) ?? -1) >= level || level > 40) return;
      if (!levels.has(name)) order.push(name);
      levels.set(name, level);
      for (const entry of list.filter((item) => item.parent === name)) visit(entry.condition.condition, level + 1);
    };
    visit(question.reponse, 1);
    nodes.push({ id: '#question', label: question.question, status: question.statut ?? 'à établir', kind: 'question', decisive: false, x: 0, y: 0 });
    for (const name of order) {
      const occurrence = list.find((item) => item.condition.condition === name);
      const term = all[name];
      nodes.push({ id: name, label: human(name), status: term ? term.statut ?? 'à établir' : occurrence?.condition.statut ?? 'à établir', kind: term ? 'terme' : 'fait', decisive: Boolean(occurrence?.condition.decisif), x: 0, y: 0 });
    }
    edges.push({ from: question.reponse, to: '#question', link: 'si' });
    for (const entry of list) if (levels.has(entry.parent) && levels.has(entry.condition.condition) && !edges.some((edge) => edge.from === entry.condition.condition && edge.to === entry.parent)) edges.push({ from: entry.condition.condition, to: entry.parent, link: entry.link });
    const rows = new Map<number, GraphNode[]>();
    for (const node of nodes) { const level = node.kind === 'question' ? 0 : levels.get(node.id)!; rows.set(level, [...(rows.get(level) ?? []), node]); }
    for (const [level, row] of rows) row.forEach((node, index) => {
      const previous = old.get(node.id);
      node.x = previous?.x ?? (index - (row.length - 1) / 2) * 170;
      node.y = previous?.y ?? level * 110;
    });
    if (selected && !nodes.some((node) => node.id === selected)) selected = '';
    if (nodes.some((node) => !old.has(node.id))) fitGraph();
    paintGraph();
  };

  const issueList = (list: ReasoningIssue[], restore = false) => (list.length ? list.map((issue) => `<div class="pmr-issue">${pill(issue.kind === 'erreur' ? 'exclu' : 'à établir', issue.kind)}<span>${escape(issue.text)}<br><code>${escape(issue.path || 'fichier')}${issue.line ? ` · ligne ${issue.line}` : ''}</code></span>${snapshot?.demo ? '' : `<button data-dismiss="${escape(issue.id)}"${restore ? ' data-restore' : ''}>${restore ? 'Rétablir' : 'Écarter'}</button>`}</div>`).join('') : '<p class="pmr-muted">Aucune.</p>');
  const sourceBlock = (source: Json) => `<div class="pmr-quote"><p><strong>${escape(source.titre ?? source.source)}</strong>${source.source && source.titre ? ` <span class="pmr-muted">${escape(source.source)}</span>` : ''}${source.vigueur ? ` · ${pill(source.en_vigueur === false ? 'exclu' : source.en_vigueur ? 'acquis' : 'à établir', `en vigueur du ${date(source.vigueur.debut)} ${source.vigueur.fin ? `au ${date(source.vigueur.fin)}` : '(toujours en vigueur)'}`)}` : ''}</p><blockquote>${escape(source.citation)}</blockquote>${source.corrigee ? `<p class="pmr-muted">Citation rétablie d’après le texte (écrite : « ${escape(source.citation_d_origine)} »).</p>` : ''}</div>`;
  const pieceBlock = (piece: Json, against = false) => {
    const rated = piece.fiable === true ? 'fiable' : piece.fiable === false ? 'non fiable' : 'à évaluer';
    const actions = snapshot?.demo ? '' : `<span class="pmr-decision"><button data-rate="${escape(piece.piece)}" data-value="true"${piece.fiable === true ? ' disabled' : ''}>Fiable</button><button data-rate="${escape(piece.piece)}" data-value="false"${piece.fiable === false ? ' disabled' : ''}>Non fiable</button>${piece.fiable === null || piece.fiable === undefined ? '' : `<button data-rate="${escape(piece.piece)}" data-value="null">Annuler</button>`}</span>`;
    return `<div class="pmr-quote"><p><strong>${against ? 'Contredit par' : 'Prouvé par'}</strong> ${escape(piece.titre ?? piece.piece)}${piece.nature ? ` · ${escape(piece.nature)}` : ''} · ${pill(piece.fiable === true ? 'acquis' : piece.fiable === false ? 'exclu' : 'à établir', rated)}</p><blockquote>${escape(piece.citation)}</blockquote>${piece.personnes?.length ? `<p class="pmr-muted">Personnes : ${escape(piece.personnes.join(', '))}</p>` : ''}${actions}</div>`;
  };
  const conditionBlock = (path: string, condition: Json) => {
    const members = Array.isArray(condition.l_une) ? `<p>L’une de : ${condition.l_une.map((member: Json) => `<button class="pmr-link" data-select="${escape(member.condition)}">${escape(human(member.condition ?? ''))}</button> ${pill(member.statut ?? 'à établir')}`).join(', ')}</p>` : '';
    const name = condition.condition ? `<button class="pmr-link" data-select="${escape(condition.condition)}">${escape(human(condition.condition))}</button> ` : '';
    return `<div class="pmr-card"><header>${path.includes('.sauf[') ? '<span class="pmr-step">Sauf</span>' : '<span class="pmr-step">Si</span>'}${name}${pill(condition.statut ?? 'à établir')}${condition.decisif ? ' <span class="pmr-pill pmr-warn">décisif</span>' : ''}</header>${members}${(condition.selon ?? []).map(sourceBlock).join('')}${(condition.preuve ?? []).map((piece: Json) => pieceBlock(piece)).join('')}${(condition.contredit ?? []).map((piece: Json) => pieceBlock(piece, true)).join('')}</div>`;
  };

  const paintDetail = () => {
    const question = questions()[scope];
    if (tab === 'code') { detail.innerHTML = snapshot?.code ? `<pre class="pmr-code">${escape(snapshot.code)}</pre>` : '<p class="pmr-muted">Aucun fichier .piecemaker/raisonnement.js.</p>'; return; }
    if (tab === 'alertes') {
      const dismissed = (snapshot?.issues ?? []).filter((issue) => dismissedIds().has(issue.id));
      const bilan = annotated()?.bilan as Json | undefined;
      detail.innerHTML = `<h4>Erreurs et manques</h4>${issueList(visibleIssues())}${bilan?.pieces_a_evaluer_par_l_avocat?.length ? `<h4>Pièces à évaluer</h4><p>${escape(bilan.pieces_a_evaluer_par_l_avocat.join(', '))}</p>` : ''}${bilan?.registre?.length ? `<h4>Registre et BODACC</h4><ul>${bilan.registre.map((line: string) => `<li>${escape(line)}</li>`).join('')}</ul>` : ''}<h4>Écartées par vous</h4>${issueList(dismissed, true)}`;
      return;
    }
    if (!question) { detail.innerHTML = '<p class="pmr-muted">Aucune question.</p>'; return; }
    if (!selected || selected === '#question') {
      const essais = Array.isArray(annotated()?.essais) ? annotated()!.essais as Json[] : [];
      detail.innerHTML = `<h3>${escape(question.question)}</h3><p>${pill(question.statut ?? 'à établir', `Réponse : ${question.statut ?? 'à établir'}`)}</p>${question.date ? `<p class="pmr-muted">Droit appliqué au ${date(question.date.valeur)}</p>${(question.date.preuve ?? []).map((piece: Json) => pieceBlock(piece)).join('')}` : ''}${question.decisifs?.length ? `<h4>Faits décisifs</h4><p>${question.decisifs.map((name: string) => `<button class="pmr-link" data-select="${escape(name)}">${escape(human(name))}</button>`).join(', ')}</p>` : ''}${question.en_jeu?.length ? `<h4>Faits en jeu</h4><p>${escape(question.en_jeu.map(human).join(', '))}</p>` : ''}${question.personnes?.length ? `<h4>Personnes</h4><p>${escape(question.personnes.join(', '))}</p>` : ''}${essais.length ? `<h4>Essais</h4>${essais.map((essai) => `<p>${pill(essai.conforme ? 'acquis' : 'exclu', essai.conforme ? 'conforme' : 'non conforme')} ${escape(essai.nom)}</p>`).join('')}` : ''}`;
      return;
    }
    const term = terms()[selected];
    if (term) {
      const own = groups().filter((entry) => entry.parent === selected);
      detail.innerHTML = `<h3>${escape(human(selected))}</h3><p>${pill(term.statut ?? 'à établir')}</p>${own.map((entry) => conditionBlock(entry.path, entry.condition)).join('')}<h4>Alertes</h4>${issueList(issuesOf([selected]).filter((issue) => !dismissedIds().has(issue.id)))}`;
      return;
    }
    const uses = occurrences().filter((entry) => entry.condition.condition === selected);
    detail.innerHTML = `<h3>${escape(human(selected))}</h3><p class="pmr-muted">Fait à établir par les pièces.</p>${uses.map((entry) => `<p class="pmr-muted">Condition de <button class="pmr-link" data-select="${escape(entry.parent)}">${escape(human(entry.parent))}</button>${entry.link === 'sauf' ? ' (exception)' : entry.link === 'l_une' ? " (l'une de)" : ''}</p>${conditionBlock(entry.path, entry.condition)}`).join('')}<h4>Alertes</h4>${issueList(issuesOf(uses.map((entry) => entry.path)).filter((issue) => !dismissedIds().has(issue.id)))}`;
  };

  const paint = () => {
    root.dataset.theme = context.theme;
    const list = questions();
    picker.hidden = list.length < 2;
    picker.innerHTML = list.map((question, index) => `<option value="${index}"${index === scope ? ' selected' : ''}>${escape(shorten(question.question, 80))}</option>`).join('');
    const bilan = annotated()?.bilan as Json | undefined;
    meta.textContent = snapshot?.demo ? 'Exemple fictif.' : bilan ? `${bilan.erreurs} erreur(s) · ${bilan.manques} manque(s)${bilan.essais ? ` · essais ${bilan.essais}` : ''}${bilan.ecartees ? ` · ${bilan.ecartees} écartée(s)` : ''}${snapshot?.updatedAt ? ` · vérifié le ${new Date(snapshot.updatedAt).toLocaleString('fr-FR')}` : ''}` : '';
    const count = root.querySelector<HTMLElement>('[data-alerts]')!;
    count.hidden = !visibleIssues().length;
    count.textContent = String(visibleIssues().length);
    root.querySelectorAll<HTMLElement>('[data-tab]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.tab === tab)));
    root.querySelector<HTMLButtonElement>('[data-verify]')!.disabled = busy || !context.project || Boolean(snapshot?.demo);
    empty.hidden = Boolean(list.length);
    empty.innerHTML = !context.project ? '<strong>Aucun dossier</strong><p>Ouvrez un dossier pour voir son raisonnement.</p>' : snapshot?.code && !snapshot.annotated ? `<strong>Raisonnement illisible</strong><p>${escape(snapshot.issues.map((issue) => issue.text).join(' · '))}</p>` : '<strong>Pas encore de raisonnement</strong><p>Posez une question juridique dans le chat : l’agent transcrit sa réponse dans .piecemaker/raisonnement.js, que ce volet vérifie et affiche.</p>';
    buildGraph();
    paintDetail();
  };

  const showError = (error: unknown) => { warning.hidden = false; warning.textContent = error instanceof Error ? error.message : String(error); };
  const apply = (data: ReasoningSnapshot) => {
    const next = JSON.stringify(data);
    warning.hidden = true;
    if (next === serialized) return;
    serialized = next;
    snapshot = data;
    if (scope >= questions().length) scope = 0;
    paint();
  };
  const load = async (example = false) => {
    const request = ++sequence;
    try {
      const data = await loadReasoning(context.project?.path ?? null, example);
      if (!stopped && request === sequence) apply(data);
    } catch (error) { if (!stopped && request === sequence) showError(error); }
  };
  const act = (run: () => Promise<ReasoningSnapshot>) => {
    busy = true;
    paint();
    run().then(apply, showError).finally(() => { busy = false; paint(); });
  };
  const select = (id: string) => { selected = selected === id ? '' : id; tab = 'detail'; paintGraph(); paint(); };

  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('button');
    if (!button) return;
    const project = context.project?.path;
    if (button.dataset.tab) { tab = button.dataset.tab as Tab; paint(); }
    if (button.hasAttribute('data-demo')) { serialized = ''; selected = ''; scope = 0; nodes = []; void load(!snapshot?.demo); }
    if (button.hasAttribute('data-refresh')) { serialized = ''; void load(Boolean(snapshot?.demo)); }
    if (button.hasAttribute('data-verify') && project) act(() => verifyReasoning(project));
    if (button.dataset.select) select(button.dataset.select);
    if (button.dataset.dismiss && project) act(() => dismissIssue(project, button.dataset.dismiss!, button.hasAttribute('data-restore')));
    if (button.dataset.rate && project) act(() => ratePiece(project, button.dataset.rate!, button.dataset.value === 'null' ? null : button.dataset.value === 'true'));
    if (button.dataset.zoom) { zoom = Math.max(.1, Math.min(3, zoom * (Number(button.dataset.zoom) > 0 ? 1.2 : 1 / 1.2))); paintGraph(); }
    if (button.hasAttribute('data-center')) { fitGraph(); paintGraph(); }
  });
  picker.addEventListener('change', () => { scope = Number(picker.value); selected = ''; nodes = []; paint(); });

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
    if (node) { node.x += dx / zoom; node.y += dy / zoom; } else { pan.x += dx; pan.y += dy; }
    drag.x = position.x;
    drag.y = position.y;
    paintGraph();
  });
  canvas.addEventListener('pointerup', (event) => {
    if (drag && !drag.moved) { if (drag.id) select(drag.id); else if (selected) select(selected); }
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  svg.addEventListener('keydown', (event) => {
    const id = (event.target as Element).closest<HTMLElement>('[data-node]')?.dataset.node;
    if (id && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); select(id); }
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoom = Math.max(.1, Math.min(3, zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
    paintGraph();
  }, { passive: false });

  const resize = new ResizeObserver(() => paintGraph());
  resize.observe(canvas);
  const unsubscribe = api.onContextChange((next) => {
    const changed = next.project?.path !== context.project?.path;
    context = next;
    if (changed) { sequence++; snapshot = null; serialized = ''; scope = 0; selected = ''; nodes = []; void load(); }
    paint();
  });
  const poll = () => { if (!stopped) { if (!snapshot?.demo && !busy) void load(); timer = window.setTimeout(poll, 2500); } };
  paint();
  void load();
  timer = window.setTimeout(poll, 2500);
  window.dispatchEvent(new CustomEvent('piecemaker:panel-focus', { detail: { tab: 'plugin:piecemaker-raisonnement' } }));
  cleanups.set(container, () => { stopped = true; sequence++; window.clearTimeout(timer); resize.disconnect(); unsubscribe(); container.replaceChildren(); });
}

export function unmount(container: HTMLElement) {
  cleanups.get(container)?.();
  cleanups.delete(container);
}
