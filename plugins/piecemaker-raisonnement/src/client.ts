import type { ReasoningIssue, ReasoningLogEntry, ReasoningSnapshot } from '../../../shared/piecemaker-reasoning.js';
import { citeSource, dismissIssue, loadReasoning, ratePiece, runTest } from './api.js';
import { STYLES } from './styles.js';

type Context = { theme: 'dark' | 'light'; project: { name: string; path: string } | null };
type Host = { readonly context: Context; onContextChange(callback: (context: Context) => void): () => void; openFileInEditor?(file: string): void };
type Tab = 'detail' | 'test' | 'alertes' | 'code';
type Json = Record<string, any>;
type Occurrence = { path: string; parent: string; link: 'si' | 'sauf' | 'l_une'; condition: Json };
type GraphNode = { id: string; label: string; status: string; kind: 'question' | 'terme' | 'fait' | 'ou' | 'piece' | 'source'; decisive: boolean; x: number; y: number };
type Edge = { from: string; to: string; link: Occurrence['link'] | 'preuve' | 'contredit' | 'selon' };
type Cited = { piece: Json; target: string; against: boolean };
type Based = { source: Json; target: string };

const RESERVED = new Set(['bilan', 'questions', 'essais']);
const COLORS: Record<string, string> = { acquis: '#68bea3', exclu: '#e08a8a', 'à établir': '#e0b354', contesté: '#ba9ce9', question: '#e2a5c6', piece: '#9aa3b2', source: '#7aa7d8' };
const ANSWER: Record<string, string> = { acquis: 'Oui', exclu: 'Non', 'à établir': 'En suspens', contesté: 'Contestée' };
const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? 's' : ''}`;
const basename = (file: string) => file.split('/').pop()!.replace(/\.[a-z0-9]+$/i, '');
const sourceLabel = (source: Json) => {
  const title = String(source.titre ?? source.source);
  const article = /article\s+(\S+)/i.exec(title);
  if (article) return `Art. ${article[1]}`;
  const pourvoi = /\b(\d{2}-\d{2}\.\d{3})\b/.exec(title);
  if (pourvoi) return `${title.startsWith('Cour de cassation') ? 'Cass.' : 'Arrêt'} ${pourvoi[1]}`;
  return /[/\\]/.test(String(source.source)) ? basename(String(source.source)) : shorten(title, 22);
};
const TONE: Record<string, string> = { acquis: 'ok', exclu: 'ko', 'à établir': 'warn', contesté: 'warn' };
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const human = (name: string) => { const text = name.replace(/_/g, ' ').replace(/(^|\s)([cdjlmnst]) (?=[aeiouyhàâéèêëîïôûù])/giu, '$1$2’'); return text.charAt(0).toUpperCase() + text.slice(1); };
const shorten = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);
const pill = (status: string, label = status) => `<span class="pmr-pill pmr-${TONE[status] ?? 'muted'}">${escape(label)}</span>`;
const date = (value: unknown) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : 'toujours en vigueur');
const MARK: Record<ReasoningLogEntry['status'], string> = { ok: '✓', alerte: '!', neutre: '', 'en cours': '' };
const STEP: Record<ReasoningLogEntry['step'], string> = { source: 'Source', pièce: 'Pièce', fait: 'Fait', condition: 'Étape', essai: 'Essai', registre: 'Registre Public', réponse: 'Réponse' };
const cleanups = new WeakMap<HTMLElement, () => void>();

export function mount(container: HTMLElement, api: Host) {
  const style = document.createElement('style');
  style.textContent = STYLES;
  const root = document.createElement('section');
  root.className = 'pmr piecemaker-ui';
  root.setAttribute('aria-label', 'Raisonnement du dossier');
  root.innerHTML = `<header class="pmr-head"><strong>Raisonnement</strong><select data-scope aria-label="Question" hidden></select><button data-demo>Exemple fictif</button><button data-refresh aria-label="Actualiser">↻</button></header><div class="pmr-legend">${['acquis', 'exclu', 'à établir', 'contesté'].map((key) => `<span><i style="background:${COLORS[key]}"></i>${escape(human(key))}</span>`).join('')}<span><i class="is-square"></i>Pièce</span><span><i class="is-diamond"></i>Source</span><span><i class="is-ring"></i>Décisif : sa preuve fait basculer la réponse</span><span>- - sauf</span><span>ou : une suffit</span></div><div class="pmr-warning" hidden></div><div class="pmr-workspace"><div class="pmr-canvas" aria-label="Graphe du raisonnement"><svg role="group" aria-label="Question, termes et faits"></svg><div class="pmr-empty" hidden></div><div class="pmr-tools"><button data-zoom="-1" aria-label="Dézoomer">−</button><button data-zoom="1" aria-label="Zoomer">+</button><button data-center>Centrer</button></div></div><div class="pmr-split" role="separator" tabindex="0" aria-label="Redimensionner le graphe et le détail"></div><div class="pmr-inspector"><div class="pmr-tabs" role="tablist"><button role="tab" data-tab="detail">Détail</button><button role="tab" data-tab="test">Test</button><button role="tab" data-tab="alertes">Alertes<span class="pmr-count" data-alerts hidden></span></button><button role="tab" data-tab="code">Code</button></div><div class="pmr-detail"></div></div></div>`;
  container.replaceChildren(style, root);
  const canvas = root.querySelector<HTMLElement>('.pmr-canvas')!;
  const svg = root.querySelector<SVGSVGElement>('svg')!;
  const detail = root.querySelector<HTMLElement>('.pmr-detail')!;
  const workspace = root.querySelector<HTMLElement>('.pmr-workspace')!;
  const inspector = root.querySelector<HTMLElement>('.pmr-inspector')!;
  const split = root.querySelector<HTMLElement>('.pmr-split')!;
  const warning = root.querySelector<HTMLElement>('.pmr-warning')!;
  const empty = root.querySelector<HTMLElement>('.pmr-empty')!;
  const picker = root.querySelector<HTMLSelectElement>('[data-scope]')!;
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
  let live: ReasoningLogEntry[] | null = null;
  let pending: ReasoningLogEntry[] = [];
  let fresh: { key: string; added: boolean } | null = null;
  let pacing = 0;
  let finish: (() => void) | null = null;
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

  const cited = (): Cited[] => {
    const found: Cited[] = [];
    for (const entry of occurrences()) for (const field of ['preuve', 'contredit'] as const) for (const piece of entry.condition[field] ?? []) found.push({ piece, target: entry.condition.condition, against: field === 'contredit' });
    return found;
  };
  const based = (): Based[] => {
    const found: Based[] = [];
    for (const group of groups()) if (Array.isArray(group.condition.l_une)) for (const source of group.condition.selon ?? []) found.push({ source, target: `#ou:${group.path}` });
    for (const entry of occurrences()) for (const source of entry.condition.selon ?? []) found.push({ source, target: entry.condition.condition });
    return found;
  };
  const size = () => ({ width: Math.max(1, canvas.clientWidth), height: Math.max(1, canvas.clientHeight) });
  const radius = (node: GraphNode) => (node.kind === 'question' ? 19 : node.kind === 'terme' ? 15 : node.kind === 'ou' || node.kind === 'piece' ? 9 : node.kind === 'source' ? 8 : 11);
  const evidence = (node: GraphNode) => node.kind === 'piece' || node.kind === 'source';
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
      const label = edge.link === 'sauf' ? 'sauf' : '';
      const path = Math.abs(a.y - b.y) < 6 ? `M${a.x + Math.sign(b.x - a.x) * radius(a)} ${a.y} L${b.x - Math.sign(b.x - a.x) * radius(b)} ${b.y}` : `M${a.x} ${a.y - radius(a)} C${a.x} ${(a.y + b.y) / 2} ${b.x} ${(a.y + b.y) / 2} ${b.x} ${b.y + radius(b)}`;
      return `<path class="pmr-edge${edge.link === 'sauf' ? ' is-sauf' : ''}${['preuve', 'contredit', 'selon'].includes(edge.link) ? ` is-${edge.link}` : ''}${lit ? ' is-neighbour' : ''}${members && !lit ? ' is-dim' : ''}" d="${path}"/>${label ? `<text class="pmr-edge-label" x="${(a.x + b.x) / 2 + 4}" y="${(a.y + b.y) / 2}">${label}</text>` : ''}`;
    }).join('')}${nodes.map((node) => (node.kind === 'ou' ? `<g class="pmr-node pmr-or${members && !members.has(node.id) ? ' is-dim' : ''}" transform="translate(${node.x} ${node.y})"><circle r="${radius(node)}" fill="var(--bg)" stroke="var(--muted)"/><text text-anchor="middle" y="4" class="pmr-value">ou</text><title>Au choix : une de ces conditions suffit</title></g>` : `<g class="pmr-node${selected === node.id ? ' is-selected' : ''}${members && !members.has(node.id) ? ' is-dim' : ''}${node.decisive ? ' is-decisive' : ''}" data-node="${escape(node.id)}" transform="translate(${node.x} ${node.y})" tabindex="0" role="button" aria-label="${escape(`${node.label}, ${node.status}`)}">${node.kind === 'piece' ? `<rect x="-${radius(node)}" y="-${radius(node)}" width="${radius(node) * 2}" height="${radius(node) * 2}" rx="3" fill="${COLORS[node.status] ?? COLORS.piece}"/>` : node.kind === 'source' ? `<rect x="-${radius(node)}" y="-${radius(node)}" width="${radius(node) * 2}" height="${radius(node) * 2}" transform="rotate(45)" fill="${COLORS[node.status] ?? COLORS.source}"/>` : `<circle r="${radius(node)}" fill="${COLORS[node.kind === 'question' ? 'question' : node.status] ?? COLORS['à établir']}"/>`}<text text-anchor="middle" y="${radius(node) + (evidence(node) ? 13 : 15)}"${node.kind === 'question' ? ' class="pmr-strong"' : evidence(node) ? ' class="pmr-small"' : ''}>${escape(shorten(node.label, evidence(node) ? 22 : 34))}</text>${node.decisive ? `<text text-anchor="middle" class="pmr-value" y="${radius(node) + 29}">décisif</text>` : ''}<title>${escape(`${node.label}\n${node.status}`)}</title></g>`)).join('')}</g>`;
  };

  const fitGraph = () => {
    if (!nodes.length) { zoom = 1; pan = { x: 0, y: 0 }; return; }
    const minX = Math.min(...nodes.map((node) => node.x)) - 90, maxX = Math.max(...nodes.map((node) => node.x)) + 90;
    const minY = Math.min(...nodes.map((node) => node.y)) - 30, maxY = Math.max(...nodes.map((node) => node.y)) + 70;
    const { width, height } = size();
    zoom = Math.min(1.2, (width - 24) / Math.max(1, maxX - minX), (height - 70) / Math.max(1, maxY - minY));
    pan = { x: -(minX + maxX) / 2 * zoom, y: -(minY + maxY) / 2 * zoom };
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
    const orLevels = new Map<string, number>();
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
    for (const group of groups().filter((entry) => levels.has(entry.parent))) {
      const link = group.path.includes('.sauf[') ? 'sauf' : 'si';
      if (!Array.isArray(group.condition.l_une)) {
        if (levels.has(group.condition.condition) && !edges.some((edge) => edge.from === group.condition.condition && edge.to === group.parent)) edges.push({ from: group.condition.condition, to: group.parent, link });
        continue;
      }
      const level = levels.get(group.parent)! + 0.5;
      nodes.push({ id: `#ou:${group.path}`, label: 'ou', status: group.condition.statut ?? 'à établir', kind: 'ou', decisive: false, x: 0, y: 0 });
      orLevels.set(`#ou:${group.path}`, level);
      edges.push({ from: `#ou:${group.path}`, to: group.parent, link });
      const members = list.filter((entry) => entry.path.startsWith(`${group.path}.l_une[`));
      for (const member of members) if (levels.has(member.condition.condition)) edges.push({ from: member.condition.condition, to: `#ou:${group.path}`, link: 'si' });
    }
    const rows = new Map<number, GraphNode[]>();
    for (const node of nodes) { const level = node.kind === 'question' ? 0 : node.kind === 'ou' ? orLevels.get(node.id)! : levels.get(node.id)!; rows.set(level, [...(rows.get(level) ?? []), node]); }
    for (const [level, row] of rows) row.forEach((node, index) => {
      const previous = old.get(node.id);
      node.x = previous?.x ?? (index - (row.length - 1) / 2) * 190;
      node.y = previous?.y ?? level * 100;
    });
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const attached = new Map<string, number>();
    const attach = (id: string, label: string, status: string, kind: 'piece' | 'source', target: string, link: Edge['link']) => {
      const anchor = byId.get(target);
      if (!anchor) return;
      if (!byId.has(id)) {
        const count = attached.get(target) ?? 0;
        attached.set(target, count + 1);
        const side = anchor.kind === 'ou' ? [66, -66, 132, -132] : anchor.kind === 'fait' ? [0, 96, -96, 192, -192] : [80, -80, 160, -160];
        const previous = old.get(id);
        const node: GraphNode = { id, label, status, kind, decisive: false, x: previous?.x ?? anchor.x + side[count % side.length], y: previous?.y ?? anchor.y + (anchor.kind === 'ou' ? 0 : 46) };
        nodes.push(node);
        byId.set(id, node);
      }
      if (!edges.some((edge) => edge.from === id && edge.to === target)) edges.push({ from: id, to: target, link });
    };
    for (const entry of based()) attach(`#source:${entry.source.source}`, sourceLabel(entry.source), entry.source.en_vigueur === false ? 'exclu' : 'source', 'source', entry.target, 'selon');
    for (const entry of cited()) attach(`#piece:${entry.piece.piece}`, entry.piece.titre ?? basename(entry.piece.piece), entry.piece.fiable === true ? 'acquis' : entry.piece.fiable === false ? 'exclu' : 'piece', 'piece', entry.target, entry.against ? 'contredit' : 'preuve');
    if (selected && !nodes.some((node) => node.id === selected)) selected = '';
    if (nodes.some((node) => !old.has(node.id))) fitGraph();
    paintGraph();
  };

  const issueList = (list: ReasoningIssue[], restore = false) => {
    const dismiss = (issue: ReasoningIssue) => (snapshot?.demo ? '' : `<button data-dismiss="${escape(issue.id)}"${restore ? ' data-restore' : ''}>${restore ? 'Rétablir' : 'Écarter'}</button>`);
    const technical = (issue: ReasoningIssue) => `<code>${escape(issue.text)} · ${escape(issue.path || 'fichier')}${issue.line ? ` · ligne ${issue.line}` : ''}</code>`;
    const open = (target: string) => `<button ${/^#(piece|source):/.test(target) ? 'data-show' : 'data-open'}="${escape(target)}">${target.startsWith('#piece:') ? 'Ouvrir la pièce' : target.startsWith('#source:') ? 'Ouvrir le texte' : 'Voir dans le graphe'}</button>`;
    const readable = list.filter((issue) => issue.avocat).map((issue) => `<div class="pmr-issue">${pill(issue.kind === 'erreur' ? 'exclu' : 'à établir', issue.kind === 'erreur' ? 'À corriger' : 'À compléter')}<div class="pmr-issue-body"><p>${escape(issue.avocat)}</p><details><summary>Détail technique</summary>${technical(issue)}</details></div><span class="pmr-decision">${issue.cible ? open(issue.cible) : ''}${dismiss(issue)}</span></div>`);
    const drafting = list.filter((issue) => !issue.avocat);
    const agent = drafting.length ? `<div class="pmr-issue">${pill('exclu', 'Rédaction')}<div class="pmr-issue-body"><p>${plural(drafting.length, 'défaut')} d’écriture du raisonnement. Rien à décider : demandez à l’agent de relancer la vérification, il les corrigera.</p><details><summary>Détail technique</summary>${drafting.map((issue) => `<p>${technical(issue)} ${dismiss(issue)}</p>`).join('')}</details></div></div>` : '';
    return readable.length || agent ? readable.join('') + agent : '<p class="pmr-muted">Aucune.</p>';
  };
  const sourceBlock = (source: Json) => `<div class="pmr-quote"><p><strong>${escape(source.titre ?? source.source)}</strong>${source.source && source.titre ? ` <span class="pmr-muted">${escape(source.source)}</span>` : ''}${source.vigueur ? ` · ${pill(source.en_vigueur === false ? 'exclu' : source.en_vigueur ? 'acquis' : 'à établir', `en vigueur du ${date(source.vigueur.debut)} ${source.vigueur.fin ? `au ${date(source.vigueur.fin)}` : '(toujours en vigueur)'}`)}` : ''}</p><blockquote>${escape(source.citation)}</blockquote>${source.corrigee ? `<p class="pmr-muted">Citation rétablie d’après le texte (écrite : « ${escape(source.citation_d_origine)} »).</p>` : ''}</div>`;
  const pieceBlock = (piece: Json, against = false) => {
    const rated = piece.fiable === true ? 'fiable' : piece.fiable === false ? 'non fiable' : 'à évaluer';
    const actions = snapshot?.demo ? '' : `<span class="pmr-decision"><button data-rate="${escape(piece.piece)}" data-value="true"${piece.fiable === true ? ' disabled' : ''}>Fiable</button><button data-rate="${escape(piece.piece)}" data-value="false"${piece.fiable === false ? ' disabled' : ''}>Non fiable</button>${piece.fiable === null || piece.fiable === undefined ? '' : `<button data-rate="${escape(piece.piece)}" data-value="null">Annuler</button>`}</span>`;
    return `<div class="pmr-quote"><p><strong>${against ? 'Contredit par' : 'Prouvé par'}</strong> ${escape(piece.titre ?? piece.piece)}${piece.nature ? ` · ${escape(piece.nature)}` : ''} · ${pill(piece.fiable === true ? 'acquis' : piece.fiable === false ? 'exclu' : 'à établir', rated)}</p><blockquote>${escape(piece.citation)}</blockquote>${piece.personnes?.length ? `<p class="pmr-muted">Personnes : ${escape(piece.personnes.join(', '))}</p>` : ''}${actions}</div>`;
  };
  const conditionBlock = (path: string, condition: Json) => {
    const members = Array.isArray(condition.l_une) ? `<p>Au choix, une suffit : ${condition.l_une.map((member: Json) => `<button class="pmr-link" data-select="${escape(member.condition)}">${escape(human(member.condition ?? ''))}</button> ${pill(member.statut ?? 'à établir')}`).join(', ')}</p>` : '';
    const name = condition.condition ? `<button class="pmr-link" data-select="${escape(condition.condition)}">${escape(human(condition.condition))}</button> ` : '';
    return `<div class="pmr-card"><header>${path.includes('.sauf[') ? '<span class="pmr-step">Sauf</span>' : '<span class="pmr-step">Si</span>'}${name}${pill(condition.statut ?? 'à établir')}${condition.decisif ? ' <span class="pmr-pill pmr-warn">décisif</span>' : ''}</header>${members}${(condition.selon ?? []).map(sourceBlock).join('')}${(condition.preuve ?? []).map((piece: Json) => pieceBlock(piece)).join('')}${(condition.contredit ?? []).map((piece: Json) => pieceBlock(piece, true)).join('')}</div>`;
  };

  const paintTest = () => {
    const entries = live ?? snapshot?.test?.log ?? [];
    const view = (entry: ReasoningLogEntry) => `<li class="pmr-entry${fresh?.key === entry.key ? fresh.added ? ' is-new' : ' is-updated' : ''}" data-step="${escape(entry.step)}" data-status="${escape(entry.status)}"><span class="pmr-mark" aria-hidden="true">${MARK[entry.status]}</span><div class="pmr-entry-head"><span class="pmr-step">${escape(entry.status === 'ok' && entry.step === 'source' ? 'Source vérifiée' : entry.status === 'ok' && entry.step === 'pièce' ? 'Pièce vérifiée' : STEP[entry.step])}</span>${(entry.step === 'source' || entry.step === 'pièce') && entry.status !== 'en cours' ? `<button class="pmr-link" data-show="#${entry.step === 'source' ? 'source' : 'piece'}:${escape(entry.key.split(':')[1])}" data-quote="${escape(entry.key.split(':').slice(2).join(':'))}"><strong>${escape(entry.subject)}</strong></button>` : `<strong>${escape(entry.subject)}</strong>`}</div><span class="pmr-entry-text">${escape(entry.text)}</span></li>`;
    const part = (title: string, lead: string, steps: ReasoningLogEntry['step'][]) => {
      const list = entries.filter((entry) => steps.includes(entry.step));
      return list.length ? `<section class="pmr-part"><h4>${title}</h4><p class="pmr-lead">${lead}</p><ol class="pmr-log" aria-live="polite">${list.map(view).join('')}</ol></section>` : '';
    };
    const alerts = entries.filter((entry) => entry.status === 'alerte').length;
    const run = snapshot?.demo
      ? '<div class="pmr-run"><span class="pmr-muted">Exemple fictif : test simulé.</span></div>'
      : `<div class="pmr-run"><button class="pmr-primary" data-run-test${live || busy || !context.project ? ' disabled' : ''}>${live ? 'Test en cours…' : snapshot?.test ? 'Relancer le test' : 'Lancer le test'}</button>${snapshot?.test && !live ? `<span class="pmr-muted">${escape(new Date(snapshot.test.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }))}</span>` : ''}${entries.length && !live ? `<span class="pmr-tally">${pill(alerts ? 'exclu' : 'acquis', alerts ? plural(alerts, 'alerte') : 'aucune alerte')}</span>` : ''}</div>`;
    detail.innerHTML = `${run}${entries.length ? '' : '<p class="pmr-muted">Le test relit chaque source et chaque pièce, puis exécute le raisonnement sur le dossier.</p>'}${part('1. En droit', 'Chaque source relue, sa citation et sa version applicable.', ['source'])}${part('2. En fait', 'Les pièces relues et les faits qu’elles établissent.', ['pièce', 'fait', 'registre'])}${part('3. Conclusion', 'Les étapes du raisonnement, les essais et la réponse.', ['condition', 'essai', 'réponse'])}`;
  };

  const paintDetail = () => {
    const question = questions()[scope];
    if (tab === 'test') { paintTest(); return; }
    if (tab === 'code') { detail.innerHTML = snapshot?.code ? `<pre class="pmr-code">${escape(snapshot.code)}</pre>` : '<p class="pmr-muted">Aucun fichier .piecemaker/raisonnement.js.</p>'; return; }
    if (tab === 'alertes') {
      const dismissed = (snapshot?.issues ?? []).filter((issue) => dismissedIds().has(issue.id));
      const bilan = annotated()?.bilan as Json | undefined;
      detail.innerHTML = `<h4>Erreurs et manques</h4>${issueList(visibleIssues())}${bilan?.pieces_a_evaluer_par_l_avocat?.length ? `<h4>Pièces dont la fiabilité est à évaluer</h4><p>${bilan.pieces_a_evaluer_par_l_avocat.map((piece: string) => `<button class="pmr-link" data-open="#piece:${escape(piece)}" data-show="#piece:${escape(piece)}">${escape(basename(piece))}</button>`).join(', ')}</p>` : ''}${bilan?.registre?.length ? `<h4>Registre et BODACC</h4><ul>${bilan.registre.map((line: string) => `<li>${escape(line)}</li>`).join('')}</ul>` : ''}<h4>Écartées par vous</h4>${issueList(dismissed, true)}`;
      return;
    }
    if (!question) { detail.innerHTML = '<p class="pmr-muted">Aucune question.</p>'; return; }
    if (!selected || selected === '#question') {
      const essais = Array.isArray(annotated()?.essais) ? annotated()!.essais as Json[] : [];
      detail.innerHTML = `<h3>${escape(question.question)}</h3><p>${pill(question.statut ?? 'à établir', `Réponse : ${ANSWER[question.statut ?? 'à établir']}`)}</p>${question.date ? `<p class="pmr-muted">Droit appliqué au ${date(question.date.valeur)}</p>${(question.date.preuve ?? []).map((piece: Json) => pieceBlock(piece)).join('')}` : ''}${question.decisifs?.length ? `<h4>Faits décisifs</h4><p>${question.decisifs.map((name: string) => `<button class="pmr-link" data-select="${escape(name)}">${escape(human(name))}</button>`).join(', ')}</p>` : ''}${question.en_jeu?.length ? `<h4>Faits en jeu</h4><p>${escape(question.en_jeu.map(human).join(', '))}</p>` : ''}${question.personnes?.length ? `<h4>Personnes</h4><p>${escape(question.personnes.join(', '))}</p>` : ''}${essais.length ? `<h4>Essais</h4>${essais.map((essai) => `<p>${pill(essai.conforme ? 'acquis' : 'exclu', essai.conforme ? 'conforme' : 'non conforme')} ${escape(essai.nom)}</p>`).join('')}` : ''}`;
      return;
    }
    if (selected.startsWith('#source:')) {
      const id = selected.slice('#source:'.length);
      const uses = based().filter((entry) => entry.source.source === id);
      detail.innerHTML = `<h3>${escape(uses[0]?.source.titre ?? id)}</h3>${uses[0] ? sourceBlock(uses[0].source) : ''}${uses.map((entry) => `<p class="pmr-muted">Fonde : ${entry.target.startsWith('#ou:') ? 'l’alternative' : `<button class="pmr-link" data-select="${escape(entry.target)}">${escape(human(entry.target))}</button>`}${entry.source.citation !== uses[0].source.citation ? ` · « ${escape(entry.source.citation)} »` : ''}</p>`).join('')}`;
      return;
    }
    if (selected.startsWith('#piece:')) {
      const file = selected.slice('#piece:'.length);
      const uses = cited().filter((entry) => entry.piece.piece === file);
      detail.innerHTML = `<h3>${escape(uses[0]?.piece.titre ?? basename(file))}</h3><p class="pmr-muted">${escape(file)}</p>${uses.map((entry) => `<p class="pmr-muted">${entry.against ? 'Contredit' : 'Prouve'} : <button class="pmr-link" data-select="${escape(entry.target)}">${escape(human(entry.target))}</button></p>${pieceBlock(entry.piece, entry.against)}`).join('')}`;
      return;
    }
    const term = terms()[selected];
    if (term) {
      const own = groups().filter((entry) => entry.parent === selected);
      detail.innerHTML = `<h3>${escape(human(selected))}</h3><p>${pill(term.statut ?? 'à établir')}</p>${own.map((entry) => conditionBlock(entry.path, entry.condition)).join('')}<h4>Alertes</h4>${issueList(issuesOf([selected]).filter((issue) => !dismissedIds().has(issue.id)))}`;
      return;
    }
    const uses = occurrences().filter((entry) => entry.condition.condition === selected);
    detail.innerHTML = `<h3>${escape(human(selected))}</h3><p class="pmr-muted">Fait à établir par les pièces.</p>${uses.map((entry) => `<p class="pmr-muted">Condition de <button class="pmr-link" data-select="${escape(entry.parent)}">${escape(human(entry.parent))}</button>${entry.link === 'sauf' ? ' (exception)' : entry.link === 'l_une' ? ' (au choix avec d’autres conditions)' : ''}</p>${conditionBlock(entry.path, entry.condition)}`).join('')}<h4>Alertes</h4>${issueList(issuesOf(uses.map((entry) => entry.path)).filter((issue) => !dismissedIds().has(issue.id)))}`;
  };

  const paint = () => {
    root.dataset.theme = context.theme;
    const list = questions();
    picker.hidden = list.length < 2;
    picker.innerHTML = list.map((question, index) => `<option value="${index}"${index === scope ? ' selected' : ''}>${escape(shorten(question.question, 80))}</option>`).join('');
    const count = root.querySelector<HTMLElement>('[data-alerts]')!;
    count.hidden = !visibleIssues().length;
    count.textContent = String(visibleIssues().length);
    root.querySelectorAll<HTMLElement>('[data-tab]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.tab === tab)));
    empty.hidden = Boolean(list.length);
    root.querySelector<HTMLElement>('.pmr-legend')!.hidden = !list.length;
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
  const reveal = () => {
    const entry = pending.shift();
    if (!entry || !live) { pacing = 0; finish?.(); return; }
    const index = live.findIndex((item) => item.key === entry.key);
    if (index >= 0) live[index] = entry; else live.push(entry);
    fresh = { key: entry.key, added: index < 0 };
    if (tab === 'test') { paintTest(); detail.querySelector('.is-new, .is-updated')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    pacing = window.setTimeout(reveal, index < 0 ? 420 : 160);
  };
  const show = (target: string, quote?: string) => {
    const project = context.project?.path;
    if (!project || snapshot?.demo) return;
    const piece = target.startsWith('#piece:');
    const id = target.slice(piece ? '#piece:'.length : '#source:'.length);
    const citation = quote ?? String((piece ? cited().find((entry) => entry.piece.piece === id)?.piece.citation : based().find((entry) => entry.source.source === id)?.source.citation) ?? '');
    const open = (path: string, passage?: { quote: string }) => window.dispatchEvent(new CustomEvent('piecemaker:open-in-editor', { detail: { path, ...(passage ? { passage } : {}) } }));
    if (piece || /[/\\]/.test(id) || /\.[a-z0-9]{2,5}$/i.test(id)) { open(`${project.replace(/\/$/, '')}/${id}`, citation ? { quote: citation } : undefined); return; }
    const source = based().find((entry) => entry.source.source === id)?.source;
    citeSource(project, id, citation).then(({ token }) => open(`piecemaker://citation/${token}/${encodeURIComponent(source ? sourceLabel(source) : id)}`), showError);
  };
  const select = (id: string) => { selected = selected === id ? '' : id; tab = 'detail'; paintGraph(); paint(); };

  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('button');
    if (!button) return;
    const project = context.project?.path;
    if (button.dataset.tab) { tab = button.dataset.tab as Tab; paint(); }
    if (button.hasAttribute('data-demo')) { serialized = ''; selected = ''; scope = 0; nodes = []; void load(!snapshot?.demo); }
    if (button.hasAttribute('data-refresh')) { serialized = ''; void load(Boolean(snapshot?.demo)); }
    if (button.hasAttribute('data-run-test') && project && !live) {
      live = [];
      pending = [];
      busy = true;
      paint();
      const done = (end: () => void) => { finish = () => { finish = null; fresh = null; live = null; end(); busy = false; paint(); }; if (!pacing && !pending.length) finish(); };
      runTest(project, (entry) => { if (entry.status === 'en cours') return; pending.push(entry); if (!pacing) reveal(); })
        .then((data) => done(() => apply(data)), (error) => done(() => showError(error)));
    }
    if (button.dataset.select) select(button.dataset.select);
    if (button.dataset.show) show(button.dataset.show, button.dataset.quote);
    if (button.dataset.open) { selected = button.dataset.open; tab = 'detail'; paintGraph(); paint(); }
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
    if (drag && !drag.moved) { if (drag.id) { select(drag.id); if (/^#(piece|source):/.test(drag.id)) show(drag.id); } else if (selected) select(selected); }
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

  const wide = () => getComputedStyle(workspace).flexDirection === 'row';
  const share = (value: number) => {
    const bounded = Math.min(0.85, Math.max(0.15, value));
    inspector.style.flex = `0 0 ${bounded * 100}%`;
    inspector.style.maxHeight = 'none';
    split.setAttribute('aria-valuenow', String(Math.round(bounded * 100)));
    try { localStorage.setItem('pmr-split', String(bounded)); } catch {}
  };
  try { const saved = Number(localStorage.getItem('pmr-split')); if (saved) share(saved); } catch {}
  split.addEventListener('pointerdown', (event) => { split.setPointerCapture(event.pointerId); split.classList.add('is-dragging'); event.preventDefault(); });
  split.addEventListener('pointermove', (event) => {
    if (!split.hasPointerCapture(event.pointerId)) return;
    const box = workspace.getBoundingClientRect();
    share(wide() ? (box.right - event.clientX) / box.width : (box.bottom - event.clientY) / box.height);
  });
  split.addEventListener('pointerup', (event) => { split.releasePointerCapture(event.pointerId); split.classList.remove('is-dragging'); });
  split.addEventListener('keydown', (event) => {
    const step = { ArrowUp: 0.05, ArrowLeft: 0.05, ArrowDown: -0.05, ArrowRight: -0.05 }[event.key];
    if (!step) return;
    event.preventDefault();
    share(inspector.getBoundingClientRect()[wide() ? 'width' : 'height'] / workspace.getBoundingClientRect()[wide() ? 'width' : 'height'] + step);
  });

  const resize = new ResizeObserver(() => { fitGraph(); paintGraph(); });
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
  cleanups.set(container, () => { stopped = true; sequence++; window.clearTimeout(timer); window.clearTimeout(pacing); resize.disconnect(); unsubscribe(); container.replaceChildren(); });
}

export function unmount(container: HTMLElement) {
  cleanups.get(container)?.();
  cleanups.delete(container);
}
