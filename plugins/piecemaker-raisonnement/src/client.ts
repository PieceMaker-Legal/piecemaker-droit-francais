import type { ReasoningIssue, ReasoningLogEntry, ReasoningSnapshot } from '../../../shared/piecemaker-reasoning.js';
import { citeSource, dismissIssue, loadReasoning, ratePiece, runTest, simulateReasoning } from './api.js';
import type { Simulation } from './api.js';
import { STYLES } from './styles.js';

type Context = { theme: 'dark' | 'light'; project: { name: string; path: string } | null };
type Host = { readonly context: Context; onContextChange(callback: (context: Context) => void): () => void; openFileInEditor?(file: string): void };
type View = 'graph' | 'test';
type Json = Record<string, any>;
type Occurrence = { path: string; parent: string; link: 'si' | 'sauf' | 'l_une'; condition: Json };
type Kind = 'question' | 'terme' | 'controle' | 'fait' | 'ou' | 'conclusion';
type Cited = { piece: Json; target: string; against: boolean };
type Based = { source: Json; target: string };
type GraphNode = { id: string; label: string; status: string; kind: Kind; decisive: boolean; sources: Json[]; pieces: Cited[]; x: number; y: number; w: number; h: number };
type Edge = { from: string; to: string; link: Occurrence['link'] };

const RESERVED = new Set(['bilan', 'objectifs', 'hypotheses', 'valeurs']);
const CONDITION_ANNOTATIONS = new Set(['l_une', 'delai', 'montant', 'selon', 'decompte', 'statut', 'decisif', 'erreurs', 'manques', 'calcul']);
const readable = (condition: Json): Json => {
  if (!condition || typeof condition !== 'object') return condition;
  const name = Object.keys(condition).find((key) => !CONDITION_ANNOTATIONS.has(key) && typeof condition[key] === 'boolean');
  const { [name ?? '']: expected, ...rest } = condition;
  return { ...rest, ...(name ? { condition: name, attendu: expected } : {}), ...(Array.isArray(rest.l_une) ? { l_une: rest.l_une.map(readable) } : {}) };
};
const readableTerm = (term: Json): Json => ({
  ...term,
  ...(Array.isArray(term.si) ? { si: term.si.map(readable) } : {}),
  ...(Array.isArray(term.sauf) ? { sauf: term.sauf.map(readable) } : {}),
  ...Object.fromEntries((['true', 'false'] as const).filter((side) => Array.isArray(term[side])).map((side) => [side, term[side].map((entry: Json) => ({ ...entry, ...(Array.isArray(entry.si) ? { si: entry.si.map(readable) } : {}) }))])),
});
const sides = ['true', 'false'] as const;
const VERBS: Record<string, string> = { obtenir: 'Obtenir', écarter: 'Écarter', réduire: 'Réduire', augmenter: 'Augmenter' };
const inputs = (condition: Json): string[] => condition.delai ? [condition.delai.de, condition.delai.a] : condition.montant ? [condition.montant.valeur, condition.montant.seuil].filter((item) => typeof item === 'string') : [];
const COLORS: Record<string, string> = { question: '#d9779f', terme: '#3b82f6', controle: '#d99a2b', fait: '#2f9e7c', ou: '#8c96ad', conclusion: '#14a3a0' };
const KINDS: Record<Exclude<Kind, 'ou'>, [string, string]> = { question: ['Objectif', '◎'], terme: ['Règle', '⚖'], controle: ['Contrôle', '◆'], fait: ['Fait', '●'], conclusion: ['Conclusion', '✓'] };
const CONTROL_PREFIXES = ['applicabilité_', 'décompte_', 'validité_', 'prescription_'];
const isControl = (name: string) => CONTROL_PREFIXES.some((prefix) => name.startsWith(prefix) || name.startsWith(`${prefix.slice(0, -1)} `));
const STATUS: Record<string, string> = { acquis: 'Acquis', exclu: 'Exclu', 'à établir': 'À établir', disputé: 'Disputé' };
const ANSWER: Record<string, string> = { acquis: 'Oui', exclu: 'Non', 'à établir': 'En suspens', disputé: 'Disputée' };
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
const TONE: Record<string, string> = { acquis: 'ok', exclu: 'ko', 'à établir': 'warn', disputé: 'warn' };
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const human = (name: string) => { const text = name.replace(/(\d)_(?=\d)/g, '$1-').replace(/_/g, ' ').replace(/(^|\s)([cdjlmnst]) (?=[aeiouyhàâéèêëîïôûù])/giu, '$1$2’'); return text.charAt(0).toUpperCase() + text.slice(1); };
const shorten = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);
const pill = (status: string, label = status) => `<span class="pmr-pill pmr-${TONE[status] ?? 'muted'}">${escape(label)}</span>`;
const date = (value: unknown) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : 'toujours en vigueur');
const amountText = (value: unknown) => (typeof value === 'number' ? value.toLocaleString('fr-FR') : typeof value === 'string' ? date(value) : 'à calculer');
const MARK: Record<ReasoningLogEntry['status'], string> = { ok: '✓', alerte: '!', neutre: '', 'en cours': '' };
const STEP: Record<ReasoningLogEntry['step'], string> = { source: 'Source', pièce: 'Pièce', fait: 'Fait', condition: 'Étape', essai: 'Hypothèse', registre: 'Partie', réponse: 'Réponse' };
const MET: Record<string, string> = { acquis: '✓', exclu: '✗', 'à établir': '?', disputé: '?' };
const GAP = 22;
const ROW = 54;
const cleanups = new WeakMap<HTMLElement, () => void>();

export function mount(container: HTMLElement, api: Host) {
  const style = document.createElement('style');
  style.textContent = STYLES;
  const root = document.createElement('section');
  root.className = 'pmr piecemaker-ui';
  root.setAttribute('aria-label', 'Raisonnement du dossier');
  root.innerHTML = `<header class="pmr-head"><strong>Raisonnement</strong><select data-reasoning aria-label="Raisonnement" hidden></select><select data-scope aria-label="Objectif" hidden></select><button data-demo>Exemple fictif</button><button data-refresh aria-label="Actualiser">↻</button></header><div class="pmr-legend">${(['question', 'terme', 'controle', 'fait', 'conclusion'] as const).map((kind) => `<span><i style="background:${COLORS[kind]}"></i>${KINDS[kind][0]}</span>`).join('')}<span><b class="pmr-chip is-source">§ Source</b></span><span><b class="pmr-chip is-piece">Pièce</b></span><span><i class="is-dashed"></i>À établir</span><span><i class="is-sauf"></i>sauf</span></div><div class="pmr-simulation" hidden></div><div class="pmr-warning" hidden></div><div class="pmr-workspace"><div class="pmr-canvas" aria-label="Graphe du raisonnement"><div class="pmr-stage"></div><div class="pmr-empty" hidden></div><div class="pmr-tools"><button data-zoom="1" aria-label="Zoomer">+</button><button data-zoom="-1" aria-label="Dézoomer">−</button><button data-center>Ajuster</button></div></div><div class="pmr-split" role="separator" tabindex="0" aria-label="Redimensionner le graphe et le test"></div><div class="pmr-inspector"><div class="pmr-tabs" role="tablist"><button role="tab" data-view="graph">Graphe</button><button role="tab" data-view="test">Test<span class="pmr-count" data-alerts hidden></span></button></div><div class="pmr-detail"></div></div></div>`;
  container.replaceChildren(style, root);
  const canvas = root.querySelector<HTMLElement>('.pmr-canvas')!;
  const stage = root.querySelector<HTMLElement>('.pmr-stage')!;
  const detail = root.querySelector<HTMLElement>('.pmr-detail')!;
  const workspace = root.querySelector<HTMLElement>('.pmr-workspace')!;
  const inspector = root.querySelector<HTMLElement>('.pmr-inspector')!;
  const split = root.querySelector<HTMLElement>('.pmr-split')!;
  const warning = root.querySelector<HTMLElement>('.pmr-warning')!;
  const empty = root.querySelector<HTMLElement>('.pmr-empty')!;
  const banner = root.querySelector<HTMLElement>('.pmr-simulation')!;
  const picker = root.querySelector<HTMLSelectElement>('[data-scope]')!;
  const chooser = root.querySelector<HTMLSelectElement>('[data-reasoning]')!;
  let context = api.context;
  let snapshot: ReasoningSnapshot | null = null;
  let reasoning: string | undefined;
  const shown = () => snapshot?.name ?? undefined;
  let serialized = '';
  let view: View = 'graph';
  let scope = 0;
  let selected = '';
  let focusing = '';
  let shape = '';
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
  let assumed: Record<string, boolean> = {};
  let simulated: Simulation | null = null;
  let simulating = 0;

  const annotated = () => (snapshot?.annotated ?? null) as Json | null;
  const values = () => (annotated()?.valeurs ?? {}) as Record<string, Json>;
  const objectives = () => (Array.isArray(annotated()?.objectifs) ? annotated()!.objectifs as Json[] : []);
  const verb = (objective: Json) => Object.keys(VERBS).find((key) => typeof objective[key] === 'string') ?? 'obtenir';
  const terms = () => Object.fromEntries(Object.entries(annotated() ?? {}).filter(([key, value]) => !RESERVED.has(key) && value && typeof value === 'object' && !Array.isArray(value)).map(([key, value]) => [key, readableTerm(value as Json)])) as Record<string, Json>;
  const occurrences = (): Occurrence[] => {
    const found: Occurrence[] = [];
    const walk = (condition: Json, at: string, parent: string, link: Occurrence['link']) => {
      if (Array.isArray(condition.l_une)) condition.l_une.forEach((member: Json, index: number) => walk(member, `${at}.l_une[${index}]`, parent, 'l_une'));
      else found.push({ path: at, parent, link, condition });
    };
    for (const [name, term] of Object.entries(terms())) {
      for (const link of ['si', 'sauf'] as const) (term[link] ?? []).forEach((condition: Json, index: number) => walk(condition, `${name}.${link}[${index}]`, name, link));
      for (const side of sides) (term[side] ?? []).forEach((entry: Json, index: number) => (entry.si ?? []).forEach((condition: Json, other: number) => walk(condition, `${name}.${side}[${index}].si[${other}]`, name, 'si')));
    }
    return found;
  };
  const groups = (): Array<{ path: string; parent: string; condition: Json }> => {
    const found: Array<{ path: string; parent: string; condition: Json }> = [];
    for (const [name, term] of Object.entries(terms())) {
      for (const link of ['si', 'sauf'] as const) (term[link] ?? []).forEach((condition: Json, index: number) => found.push({ path: `${name}.${link}[${index}]`, parent: name, condition }));
      for (const side of sides) (term[side] ?? []).forEach((entry: Json, index: number) => (entry.si ?? []).forEach((condition: Json, other: number) => found.push({ path: `${name}.${side}[${index}].si[${other}]`, parent: name, condition })));
    }
    return found;
  };
  const issuesOf = (paths: string[]) => (snapshot?.issues ?? []).filter((issue) => issue.kind !== 'conseil' && paths.some((at) => issue.path === at || issue.path.startsWith(`${at}.`) || issue.path.startsWith(`${at}[`)));
  const dismissedIds = () => new Set((snapshot?.dismissed ?? []).map((entry) => entry.id));
  const visibleIssues = () => (snapshot?.issues ?? []).filter((issue) => issue.kind !== 'conseil' && !dismissedIds().has(issue.id));
  const log = () => live ?? snapshot?.test?.log ?? [];
  const statusOf = (name: string, fallback: string) => simulated?.termes[name] ?? fallback;
  const met = (condition: Json): string => {
    if (Array.isArray(condition.l_une)) {
      const members = condition.l_une.map(met);
      return members.includes('acquis') ? 'acquis' : members.every((status: string) => status === 'exclu') ? 'exclu' : 'à établir';
    }
    const value = simulated?.termes[condition.condition];
    if (!value) return condition.statut ?? 'à établir';
    if (value !== 'acquis' && value !== 'exclu') return 'à établir';
    return (value === 'acquis') === (condition.attendu !== false) ? 'acquis' : 'exclu';
  };
  const answerOf = (objective: Json) => simulated?.objectifs[scope]?.statut ?? objective.statut ?? 'à établir';

  const cited = (): Cited[] => {
    const found: Cited[] = [];
    for (const [name, term] of Object.entries(terms())) for (const side of sides) for (const entry of term[side] ?? []) for (const piece of entry.preuve ?? []) found.push({ piece, target: name, against: side === 'false' });
    for (const entry of occurrences()) for (const name of inputs(entry.condition)) for (const piece of values()[name]?.preuve ?? []) found.push({ piece, target: entry.condition.condition, against: false });
    return found;
  };
  const based = (): Based[] => {
    const found: Based[] = [];
    for (const group of groups()) if (Array.isArray(group.condition.l_une)) for (const source of group.condition.selon ?? []) found.push({ source, target: `#ou:${group.path}` });
    for (const entry of occurrences()) for (const source of entry.condition.selon ?? []) found.push({ source, target: entry.condition.condition });
    for (const [name, term] of Object.entries(terms())) for (const side of sides) for (const entry of term[side] ?? []) for (const source of entry.selon ?? []) found.push({ source, target: name });
    return found;
  };
  const branch = (id: string) => {
    const found = new Set([id]);
    const walk = (current: string, up: boolean) => { for (const edge of edges) { const [from, to] = up ? [edge.to, edge.from] : [edge.from, edge.to]; if (from === current && !found.has(to)) { found.add(to); walk(to, up); } } };
    walk(id, true);
    walk(id, false);
    return found;
  };
  const testMark = (node: GraphNode) => {
    const prefixes = [...node.sources.map((source) => `source:${source.source}:`), ...node.pieces.map((entry) => `piece:${entry.piece.piece}:`)];
    const mine = log().filter((entry) => entry.key === `terme:${node.id}` || entry.key === `fait:${node.id}` || (node.kind === 'conclusion' && entry.key === `réponse:${scope}`) || prefixes.some((prefix) => entry.key.startsWith(prefix)));
    const paths = node.kind === 'conclusion' || node.kind === 'question' ? [] : [node.id, ...occurrences().filter((entry) => entry.condition.condition === node.id).map((entry) => entry.path)];
    const flagged = issuesOf(paths).some((issue) => !dismissedIds().has(issue.id));
    return flagged || mine.some((entry) => entry.status === 'alerte') ? 'alerte' : mine.some((entry) => entry.status === 'ok') ? 'ok' : '';
  };

  const buildGraph = () => {
    nodes = [];
    edges = [];
    const objective = objectives()[scope];
    if (!objective) return;
    const all = terms();
    const list = occurrences();
    const levels = new Map<string, number>();
    const order: string[] = [];
    const visit = (name: string, level: number) => {
      if ((levels.get(name) ?? -1) >= level || level > 40) return;
      if (!levels.has(name)) order.push(name);
      levels.set(name, level);
      for (const entry of list.filter((item) => item.parent === name)) { visit(entry.condition.condition, level + 1); if (typeof entry.condition.decompte === 'string') visit(entry.condition.decompte, level + 2); }
      for (const group of groups().filter((item) => item.parent === name)) for (const source of [group.condition, ...(group.condition.l_une ?? [])].flatMap((condition: Json) => condition.selon ?? [])) for (const control of [source.applicabilite, source.validite]) if (typeof control === 'string') visit(control, level + 1);
    };
    const node = (id: string, label: string, status: string, kind: Kind, decisive = false): GraphNode => ({ id, label, status, kind, decisive, sources: [], pieces: [], x: 0, y: 0, w: 0, h: 0 });
    visit(objective[verb(objective)], 1);
    for (const control of [objective.validite, objective.prescription]) if (typeof control === 'string') visit(control, 1);
    const answered = answerOf(objective);
    const amount = simulated ? simulated.objectifs[scope]?.montant : objective.montant_calcule;
    nodes.push(node('#question', objective.objectif, answered, 'question'));
    nodes.push(node('#conclusion', 'montant_calcule' in objective ? amountText(amount) : ANSWER[answered] ?? 'En suspens', answered, 'conclusion'));
    for (const name of order) {
      const occurrence = list.find((item) => item.condition.condition === name);
      const term = all[name];
      nodes.push(node(name, human(name), statusOf(name, term ? term.statut ?? 'à établir' : occurrence?.condition.statut ?? 'à établir'), term ? (isControl(name) ? 'controle' : term.true || term.false ? 'fait' : 'terme') : 'fait', Boolean(occurrence?.condition.decisif)));
    }
    for (const entry of list) if (typeof entry.condition.decompte === 'string' && levels.has(entry.condition.decompte) && levels.has(entry.condition.condition)) edges.push({ from: entry.condition.decompte, to: entry.condition.condition, link: 'si' });
    for (const group of groups().filter((entry) => levels.has(entry.parent))) {
      const link = group.path.includes('.sauf[') ? 'sauf' : 'si';
      if (!Array.isArray(group.condition.l_une)) {
        if (levels.has(group.condition.condition) && !edges.some((edge) => edge.from === group.condition.condition && edge.to === group.parent)) edges.push({ from: group.condition.condition, to: group.parent, link });
        continue;
      }
      nodes.push(node(`#ou:${group.path}`, 'L’une des conditions', met(group.condition), 'ou'));
      edges.push({ from: `#ou:${group.path}`, to: group.parent, link });
      for (const member of list.filter((entry) => entry.path.startsWith(`${group.path}.l_une[`))) if (levels.has(member.condition.condition)) edges.push({ from: member.condition.condition, to: `#ou:${group.path}`, link: 'l_une' });
    }
    const byId = new Map(nodes.map((item) => [item.id, item]));
    for (const entry of based()) {
      const target = byId.get(entry.target);
      if (!target) continue;
      if (!target.sources.some((source) => source.source === entry.source.source)) target.sources.push(entry.source);
      for (const control of [entry.source.applicabilite, entry.source.validite]) if (typeof control === 'string' && control !== entry.target && levels.has(control) && !edges.some((edge) => edge.from === control && edge.to === entry.target)) edges.push({ from: control, to: entry.target, link: 'si' });
    }
    for (const entry of cited()) { const target = byId.get(entry.target); if (target && !target.pieces.some((item) => item.piece.piece === entry.piece.piece)) target.pieces.push(entry); }
    const ruled = new Set(edges.map((edge) => edge.to));
    const leaves = nodes.filter((item) => item.kind === 'fait' && !ruled.has(item.id));
    for (const item of leaves.length ? leaves : nodes.filter((entry) => entry.id === objective[verb(objective)])) edges.push({ from: item.id, to: '#conclusion', link: 'si' });
    if (selected && !byId.has(selected)) selected = '';
  };

  const law = (term: Json) => {
    const blocks: Array<{ key: string; sources: Json[]; rows: string[] }> = [];
    const row = (condition: Json, link: 'si' | 'sauf'): string => {
      const status = met(condition);
      const tone = link === 'sauf' ? { acquis: 'ko', exclu: 'ok' }[status] ?? 'warn' : TONE[status] ?? 'warn';
      if (Array.isArray(condition.l_une)) return `<li class="is-${tone}"><span class="pmr-met">${MET[status]}</span><span>${link === 'sauf' ? 'Sauf l’une de' : 'L’une de'} :<ul>${condition.l_une.map((member: Json) => row(member, 'si')).join('')}</ul></span></li>`;
      const label = `${link === 'sauf' ? 'Sauf ' : ''}${condition.attendu === false ? 'absence de : ' : ''}${human(String(condition.condition))}`;
      return `<li class="is-${tone}"><span class="pmr-met" title="${escape(STATUS[status] ?? '')}">${MET[status]}</span><button class="pmr-link" data-select="${escape(condition.condition)}">${escape(label)}</button>${condition.decisif ? '<span class="pmr-pill pmr-accent">décisif</span>' : ''}</li>`;
    };
    for (const link of ['si', 'sauf'] as const) for (const condition of term[link] ?? []) {
      const sources = [condition, ...(condition.l_une ?? [])].flatMap((item: Json) => item.selon ?? []).filter((source: Json, index: number, all: Json[]) => all.findIndex((other) => other.source === source.source && other.citation === source.citation) === index);
      const key = sources.map((source: Json) => `${source.source}:${source.citation}`).join('|');
      const last = blocks[blocks.length - 1];
      if (last && last.key === key) last.rows.push(row(condition, link)); else blocks.push({ key, sources, rows: [row(condition, link)] });
    }
    if (!blocks.length) return '';
    return `<div class="pmr-law">${blocks.map((block) => `<div class="pmr-rule">${block.sources.map((source) => `<button class="pmr-chip is-source${source.en_vigueur === false ? ' is-against' : ''}" data-show="#source:${escape(source.source)}" data-quote="${escape(source.citation ?? '')}" title="${escape(String(source.titre ?? source.source))}">§ ${escape(sourceLabel(source))}</button>${source.citation ? `<q>${escape(shorten(String(source.citation), 110))}</q>` : ''}`).join('')}${block.sources.length ? '' : '<span class="pmr-muted">Sans source citée</span>'}<ul class="pmr-conds">${block.rows.join('')}</ul></div>`).join('')}</div>`;
  };
  const toggles = (name: string) => `<div class="pmr-assume" role="group" aria-label="Simuler ce fait">${([['true', 'Vrai'], ['false', 'Faux'], ['', 'Dossier']] as const).map(([value, label]) => `<button data-assume="${escape(name)}" data-value="${value}" aria-pressed="${value === '' ? !(name in assumed) : assumed[name] === (value === 'true')}">${label}</button>`).join('')}</div>`;

  const box = (node: GraphNode) => {
    if (node.kind === 'ou') return `<div class="pmr-box pmr-ou" data-id="${escape(node.id)}">L’une des conditions</div>`;
    const [kind, icon] = KINDS[node.kind];
    const objective = objectives()[scope] ?? {};
    const mark = testMark(node);
    const term = terms()[node.id];
    const facts = node.kind === 'fait' && !(term?.si?.length || term?.sauf?.length);
    const chips = [
      ...(facts ? sides.flatMap((side) => term?.[side] ?? []).flatMap((entry: Json) => entry.selon ?? []) : []).map((source) => `<button class="pmr-chip is-source${source.en_vigueur === false ? ' is-against' : ''}" data-show="#source:${escape(source.source)}" title="${escape(`${source.titre ?? source.source}\n« ${source.citation ?? ''} »`)}">§ ${escape(sourceLabel(source))}</button>`),
      ...node.pieces.map((entry) => `<button class="pmr-chip is-piece${entry.against ? ' is-against' : ''}" data-show="#piece:${escape(entry.piece.piece)}" title="${escape(`${entry.against ? 'Contredit par' : 'Prouvé par'} ${entry.piece.titre ?? entry.piece.piece}\n« ${entry.piece.citation ?? ''} »`)}">${escape(shorten(String(entry.piece.titre ?? basename(entry.piece.piece)), 26))}</button>`),
    ];
    const decisifs = Array.isArray(objective.decisifs) ? objective.decisifs as string[] : [];
    const body = node.kind === 'question'
      ? `<strong class="pmr-editorial">${escape(node.label)}</strong>`
      : node.kind === 'conclusion'
        ? `<strong>Réponse : ${escape(node.label)}</strong>${decisifs.length ? `<p class="pmr-sub">Dépend de : ${decisifs.map((name) => escape(human(name))).join(', ')}</p>` : ''}`
        : `<strong>${escape(node.label)}</strong>${term ? law(term) : ''}${chips.length ? `<div class="pmr-chips">${chips.join('')}</div>` : ''}<div class="pmr-foot">${pill(node.status, STATUS[node.status] ?? 'À établir')}${node.decisive ? '<span class="pmr-pill pmr-accent">décisif</span>' : ''}${node.id in assumed ? '<span class="pmr-pill pmr-accent">supposé</span>' : ''}</div>${facts ? toggles(node.id) : ''}`;
    const uncertain = ['terme', 'controle', 'fait', 'conclusion'].includes(node.kind) && ['à établir', 'disputé'].includes(node.status);
    return `<div class="pmr-box pmr-${node.kind}${uncertain ? ' is-uncertain' : ''}${node.status === 'exclu' && node.kind !== 'question' ? ' is-excluded' : ''}" data-id="${escape(node.id)}" data-node="${escape(node.id)}" tabindex="0" role="button" aria-label="${escape(`${kind} : ${node.label}`)}"><span class="pmr-icon" aria-hidden="true">${icon}</span><div class="pmr-box-body"><span class="pmr-kind">${kind}</span>${body}</div>${mark ? `<span class="pmr-test is-${mark}" title="${mark === 'ok' ? 'Vérifié par le test' : 'Alerte : voir le test'}">${MARK[mark]}</span>` : ''}</div>`;
  };

  const transform = () => { stage.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`; };
  const fitGraph = () => {
    const placed = nodes.filter((node) => node.w);
    if (!placed.length) return;
    const minX = Math.min(...placed.map((node) => node.x - node.w / 2)), maxX = Math.max(...placed.map((node) => node.x + node.w / 2));
    const minY = Math.min(...placed.map((node) => node.y)), maxY = Math.max(...placed.map((node) => node.y + node.h));
    const width = canvas.clientWidth, height = canvas.clientHeight;
    zoom = Math.min(1, (width - 40) / (maxX - minX), Math.max(.75, (height - 64) / (maxY - minY)));
    pan = { x: Math.max(20, (width - (maxX - minX) * zoom) / 2) - minX * zoom, y: Math.max(20, (height - 44 - (maxY - minY) * zoom) / 2) - minY * zoom };
  };
  const center = (id: string) => {
    const node = nodes.find((item) => item.id === id);
    if (!node) return;
    pan = { x: canvas.clientWidth / 2 - node.x * zoom, y: canvas.clientHeight / 2 - (node.y + node.h / 2) * zoom };
  };
  const highlight = () => {
    const members = selected ? branch(selected).add('#question') : null;
    stage.querySelectorAll<HTMLElement>('[data-id]').forEach((element) => { element.classList.toggle('is-selected', element.dataset.id === selected); element.classList.toggle('is-dim', Boolean(members && !members.has(element.dataset.id!))); });
    stage.querySelectorAll<SVGElement>('[data-from]').forEach((element) => { const lit = Boolean(members?.has(element.dataset.from!) && members.has(element.dataset.to!)); element.classList.toggle('is-lit', lit); element.classList.toggle('is-dim', Boolean(members && !lit)); });
  };

  const layoutGraph = (refit = false) => {
    if (!canvas.clientWidth || !nodes.length) return;
    const byId = new Map(nodes.map((node) => [node.id, node]));
    stage.querySelectorAll<HTMLElement>('[data-id]').forEach((element) => { const node = byId.get(element.dataset.id!); if (node) { node.w = element.offsetWidth; node.h = element.offsetHeight; } });
    const inner = edges.filter((edge) => edge.to !== '#conclusion');
    const ruled = new Set(inner.map((edge) => edge.to));
    const upper = (node: GraphNode) => node.kind !== 'question' && node.kind !== 'conclusion' && (node.kind !== 'fait' || ruled.has(node.id));
    const layer = new Map([['#question', 0]]);
    for (const node of nodes) if (upper(node) && !inner.some((edge) => edge.from === node.id)) layer.set(node.id, 1);
    for (let pass = 0; pass < nodes.length; pass++) {
      let changed = false;
      for (const edge of inner) { const above = layer.get(edge.to); if (above !== undefined && above < nodes.length && upper(byId.get(edge.from)!) && above + 1 > (layer.get(edge.from) ?? 0)) { layer.set(edge.from, above + 1); changed = true; } }
      if (!changed) break;
    }
    for (const node of nodes) if (upper(node) && !layer.has(node.id)) layer.set(node.id, 1);
    const facts = Math.max(...layer.values()) + 1;
    for (const node of nodes) if (node.kind !== 'conclusion' && !layer.has(node.id)) layer.set(node.id, facts);
    const deepest = Math.max(...layer.values()) + 1;
    layer.set('#conclusion', deepest);
    const wired = [...nodes.filter((node) => layer.get(node.id) === 1).map((node): Edge => ({ from: node.id, to: '#question', link: 'si' })), ...edges];
    for (let level = 0; level <= deepest; level++) {
      const wanted = new Map(nodes.filter((node) => layer.get(node.id) === level).map((node) => {
        const targets = wired.filter((edge) => edge.from === node.id || edge.to === node.id).map((edge) => byId.get(edge.from === node.id ? edge.to : edge.from)!).filter((other) => layer.get(other.id)! < level).map((other) => other.x);
        return [node, level === 0 ? 0 : targets.length ? targets.reduce((sum, x) => sum + x, 0) / targets.length : Infinity] as const;
      }));
      const row = [...wanted.keys()].sort((a, b) => wanted.get(a)! - wanted.get(b)!);
      let cursor = -Infinity;
      for (const node of row) { const goal = wanted.get(node)!; node.x = Math.max(Number.isFinite(goal) ? goal : cursor + node.w / 2, cursor + node.w / 2); cursor = node.x + node.w / 2 + GAP; }
      const placed = row.filter((node) => Number.isFinite(wanted.get(node)!));
      const excess = placed.length ? placed.reduce((sum, node) => sum + node.x - wanted.get(node)!, 0) / placed.length / 2 : 0;
      row.forEach((node) => { node.x -= excess; });
    }
    let top = 0;
    for (let level = 0; level <= deepest; level++) {
      const row = nodes.filter((node) => layer.get(node.id) === level);
      row.forEach((node) => { node.y = top; });
      top += Math.max(0, ...row.map((node) => node.h)) + ROW;
    }
    stage.querySelectorAll<HTMLElement>('[data-id]').forEach((element) => { const node = byId.get(element.dataset.id!); if (node) { element.style.left = `${node.x - node.w / 2}px`; element.style.top = `${node.y}px`; } });
    const markers = Object.entries(COLORS).map(([kind, color]) => `<marker id="pmr-arrow-${kind}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill="${color}"/></marker>`).join('');
    const wires = wired.map((edge) => {
      const [a, b] = [byId.get(edge.from), byId.get(edge.to)].sort((one, other) => (layer.get(one?.id ?? '') ?? 0) - (layer.get(other?.id ?? '') ?? 0));
      if (!a || !b) return '';
      const x1 = a.x, y1 = a.y + a.h, x2 = b.x, y2 = b.y - 2, bend = Math.min(y2 - y1, ROW * 1.5) / 2;
      return `<path class="pmr-wire${edge.link === 'sauf' ? ' is-sauf' : ''}" data-from="${escape(edge.from)}" data-to="${escape(edge.to)}" stroke="${COLORS[a.kind]}" marker-end="url(#pmr-arrow-${a.kind})" d="M${x1} ${y1} C${x1} ${y1 + bend} ${x2} ${y2 - bend} ${x2} ${y2}"/>${edge.link === 'sauf' ? `<text class="pmr-wire-label" data-from="${escape(edge.from)}" data-to="${escape(edge.to)}" x="${x2 + 6}" y="${y2 - bend / 2}">sauf</text>` : ''}`;
    }).join('');
    stage.querySelector('svg')!.innerHTML = `<defs>${markers}</defs>${wires}`;
    const key = nodes.map((node) => node.id).join('|');
    if (refit || key !== shape) { shape = key; fitGraph(); }
    if (focusing) { center(focusing); focusing = ''; }
    transform();
    highlight();
  };
  const paintGraph = () => {
    stage.innerHTML = `<svg class="pmr-wires" aria-hidden="true"></svg>${nodes.map(box).join('')}`;
    layoutGraph();
  };

  const issueList = (list: ReasoningIssue[], restore = false) => {
    const dismiss = (issue: ReasoningIssue) => (snapshot?.demo ? '' : `<button data-dismiss="${escape(issue.id)}"${restore ? ' data-restore' : ''}>${restore ? 'Rétablir' : 'Écarter'}</button>`);
    const technical = (issue: ReasoningIssue) => `<code>${escape(issue.text)} · ${escape(issue.path || 'fichier')}${issue.line ? ` · ligne ${issue.line}` : ''}</code>`;
    const open = (target: string) => /^#(piece|source):/.test(target) ? `<button data-show="${escape(target)}">${target.startsWith('#piece:') ? 'Ouvrir la pièce' : 'Ouvrir le texte'}</button>` : `<button data-select="${escape(target)}">Voir dans le graphe</button>`;
    const readable = list.filter((issue) => issue.avocat).map((issue) => `<div class="pmr-issue">${pill(issue.kind === 'erreur' ? 'exclu' : 'à établir', issue.kind === 'erreur' ? 'À corriger' : 'À compléter')}<div class="pmr-issue-body"><p>${escape(issue.avocat)}</p><details><summary>Détail technique</summary>${technical(issue)}</details></div><span class="pmr-decision">${issue.cible ? open(issue.cible) : ''}${dismiss(issue)}</span></div>`);
    const drafting = list.filter((issue) => !issue.avocat);
    const agent = drafting.length ? `<div class="pmr-issue">${pill('exclu', 'Rédaction')}<div class="pmr-issue-body"><p>${plural(drafting.length, 'défaut')} d’écriture du raisonnement. Rien à décider : demandez à l’agent de relancer la vérification, il les corrigera.</p><details><summary>Détail technique</summary>${drafting.map((issue) => `<p>${technical(issue)} ${dismiss(issue)}</p>`).join('')}</details></div></div>` : '';
    return readable.join('') + agent;
  };

  const paintTest = () => {
    const entries = log();
    const rating = (entry: ReasoningLogEntry) => {
      if (snapshot?.demo || entry.step !== 'pièce' || entry.status === 'en cours') return '';
      const file = entry.key.split(':')[1];
      const reliable = cited().find((item) => item.piece.piece === file)?.piece.fiable;
      return `<span class="pmr-decision"><button data-rate="${escape(file)}" data-value="true"${reliable === true ? ' disabled' : ''}>Fiable</button><button data-rate="${escape(file)}" data-value="false"${reliable === false ? ' disabled' : ''}>Non fiable</button>${reliable === null || reliable === undefined ? '' : `<button data-rate="${escape(file)}" data-value="null">Annuler</button>`}</span>`;
    };
    const subject = (entry: ReasoningLogEntry) => {
      if ((entry.step === 'source' || entry.step === 'pièce') && entry.status !== 'en cours') return `<button class="pmr-link" data-show="#${entry.step === 'source' ? 'source' : 'piece'}:${escape(entry.key.split(':')[1])}" data-quote="${escape(entry.key.split(':').slice(2).join(':'))}"><strong>${escape(entry.subject)}</strong></button>`;
      const name = /^(fait|terme):(.+)$/.exec(entry.key)?.[2];
      return name && nodes.some((node) => node.id === name) ? `<button class="pmr-link" data-select="${escape(name)}"><strong>${escape(entry.subject)}</strong></button>` : `<strong>${escape(entry.subject)}</strong>`;
    };
    const view = (entry: ReasoningLogEntry) => `<li class="pmr-entry${fresh?.key === entry.key ? fresh.added ? ' is-new' : ' is-updated' : ''}" data-step="${escape(entry.step)}" data-status="${escape(entry.status)}"><span class="pmr-mark" aria-hidden="true">${MARK[entry.status]}</span><div class="pmr-entry-head"><span class="pmr-step">${escape(entry.status === 'ok' && entry.step === 'source' ? 'Source vérifiée' : entry.status === 'ok' && entry.step === 'pièce' ? 'Pièce et citation vérifiées' : STEP[entry.step])}</span>${subject(entry)}</div><span class="pmr-entry-text">${escape(entry.text)}</span>${rating(entry)}</li>`;
    const part = (title: string, lead: string, steps: ReasoningLogEntry['step'][]) => {
      const list = entries.filter((entry) => steps.includes(entry.step));
      return list.length ? `<section class="pmr-part"><h4>${title}</h4><p class="pmr-lead">${lead}</p><ol class="pmr-log" aria-live="polite">${list.map(view).join('')}</ol></section>` : '';
    };
    const alerts = entries.filter((entry) => entry.status === 'alerte').length;
    const run = snapshot?.demo
      ? '<div class="pmr-run"><span class="pmr-muted">Exemple fictif : test simulé.</span></div>'
      : `<div class="pmr-run"><button class="pmr-primary" data-run-test${live || busy || !context.project ? ' disabled' : ''}>${live ? 'Test en cours…' : snapshot?.test ? 'Relancer le test' : 'Lancer le test'}</button>${snapshot?.test && !live ? `<span class="pmr-muted">${escape(new Date(snapshot.test.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }))}</span>` : ''}${entries.length && !live ? `<span class="pmr-tally">${pill(alerts ? 'exclu' : 'acquis', alerts ? plural(alerts, 'alerte') : 'aucune alerte')}</span>` : ''}</div>`;
    const issues = visibleIssues();
    const dismissed = (snapshot?.issues ?? []).filter((issue) => dismissedIds().has(issue.id));
    detail.innerHTML = `${run}${issues.length ? `<section class="pmr-part"><h4>À corriger</h4><p class="pmr-lead">Erreurs et manques relevés dans le raisonnement.</p>${issueList(issues)}</section>` : ''}${entries.length ? '' : '<p class="pmr-muted">Le test relit chaque source et chaque pièce, puis exécute le raisonnement sur le dossier.</p>'}${part('1. En droit', 'Chaque source relue, sa citation et sa version applicable.', ['source'])}${part('2. En fait', 'Les pièces relues et les faits qu’elles établissent.', ['pièce', 'fait', 'registre'])}${part('3. Conclusion', 'Les étapes du raisonnement, les hypothèses et la réponse.', ['condition', 'essai', 'réponse'])}${dismissed.length ? `<details class="pmr-part"><summary class="pmr-muted">Écartées par vous (${dismissed.length})</summary>${issueList(dismissed, true)}</details>` : ''}`;
  };

  const paintView = () => {
    root.dataset.view = view;
    root.querySelectorAll<HTMLElement>('[data-view]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.view === view)));
  };
  const paint = () => {
    root.dataset.theme = context.theme;
    const list = objectives();
    picker.hidden = list.length < 2;
    const available = snapshot?.demo ? [] : snapshot?.raisonnements ?? [];
    chooser.hidden = available.length < 2;
    chooser.innerHTML = available.map((name) => `<option value="${escape(name)}"${name === snapshot?.name ? ' selected' : ''}>${escape(name)}</option>`).join('');
    picker.innerHTML = list.map((objective, index) => `<option value="${index}"${index === scope ? ' selected' : ''}>${escape(shorten(objective.objectif, 80))}</option>`).join('');
    const count = root.querySelector<HTMLElement>('[data-alerts]')!;
    const alerts = visibleIssues().length + log().filter((entry) => entry.status === 'alerte').length;
    count.hidden = !alerts;
    count.textContent = String(alerts);
    paintView();
    empty.hidden = Boolean(list.length);
    root.querySelector<HTMLElement>('.pmr-legend')!.hidden = !list.length;
    empty.innerHTML = !context.project ? '<strong>Aucun dossier</strong><p>Ouvrez un dossier pour voir son raisonnement.</p>' : snapshot?.code && !snapshot.annotated ? `<strong>Raisonnement illisible</strong><p>${escape(snapshot.issues.map((issue) => issue.text).join(' · '))}</p>` : '<strong>Pas encore de raisonnement</strong><p>Confiez un objectif juridique à l’agent dans le chat : il transcrit son raisonnement dans .piecemaker/raisonnements/, un fichier par sujet, que ce volet vérifie et affiche.</p>';
    buildGraph();
    paintGraph();
    paintTest();
  };

  const paintBanner = () => {
    const count = Object.keys(assumed).length;
    banner.hidden = !count;
    banner.innerHTML = count ? `<strong>Simulation</strong><span>${plural(count, 'fait')} supposé${count > 1 ? 's' : ''} : ${Object.entries(assumed).map(([name, value]) => `${escape(human(name))} = ${value ? 'vrai' : 'faux'}`).join(' · ')}</span><button data-reset>Revenir au dossier</button>` : '';
  };
  const simulate = () => {
    const request = ++simulating;
    paintBanner();
    if (!Object.keys(assumed).length) { simulated = null; paint(); return; }
    simulateReasoning(context.project?.path ?? null, assumed, Boolean(snapshot?.demo), shown())
      .then((result) => { if (!stopped && request === simulating) { simulated = result; warning.hidden = true; paint(); } }, showError);
  };
  const showError = (error: unknown) => { warning.hidden = false; warning.textContent = error instanceof Error ? error.message : String(error); };
  const apply = (data: ReasoningSnapshot) => {
    const next = JSON.stringify(data);
    warning.hidden = true;
    if (next === serialized) return;
    serialized = next;
    snapshot = data;
    if (scope >= objectives().length) scope = 0;
    if (Object.keys(assumed).length) simulate(); else paint();
  };
  const load = async (example = false) => {
    const request = ++sequence;
    try {
      const data = await loadReasoning(context.project?.path ?? null, example, reasoning);
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
    paintTest();
    paintGraph();
    detail.querySelector('.is-new, .is-updated')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
    citeSource(project, id, citation, shown()).then(({ token }) => open(`piecemaker://citation/${token}/${encodeURIComponent(source ? sourceLabel(source) : id)}`), showError);
  };
  const select = (id: string) => { selected = selected === id ? '' : id; highlight(); };
  const reach = (id: string) => {
    selected = id;
    const hidden = view !== 'graph' && !canvas.clientWidth;
    view = 'graph';
    paintView();
    if (hidden) focusing = id; else { center(id); transform(); highlight(); }
  };

  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('button');
    if (!button) return;
    const project = context.project?.path;
    if (button.dataset.view) { view = button.dataset.view as View; paintView(); }
    if (button.hasAttribute('data-demo')) { assumed = {}; simulated = null; paintBanner(); serialized = ''; selected = ''; scope = 0; shape = ''; void load(!snapshot?.demo); }
    if (button.hasAttribute('data-refresh')) { serialized = ''; void load(Boolean(snapshot?.demo)); }
    if (button.hasAttribute('data-run-test') && project && !live) {
      live = [];
      pending = [];
      busy = true;
      paint();
      const done = (end: () => void) => { finish = () => { finish = null; fresh = null; live = null; end(); busy = false; paint(); }; if (!pacing && !pending.length) finish(); };
      runTest(project, (entry) => { if (entry.status === 'en cours') return; pending.push(entry); if (!pacing) reveal(); }, shown())
        .then((data) => done(() => apply(data)), (error) => done(() => showError(error)));
    }
    if (button.dataset.assume !== undefined) {
      const name = button.dataset.assume;
      if (button.dataset.value === '') delete assumed[name]; else assumed = { ...assumed, [name]: button.dataset.value === 'true' };
      simulate();
    }
    if (button.hasAttribute('data-reset')) { assumed = {}; simulate(); }
    if (button.dataset.select) reach(button.dataset.select);
    if (button.dataset.show) show(button.dataset.show, button.dataset.quote);
    if (button.dataset.dismiss && project) act(() => dismissIssue(project, button.dataset.dismiss!, button.hasAttribute('data-restore'), shown()));
    if (button.dataset.rate && project) act(() => ratePiece(project, button.dataset.rate!, button.dataset.value === 'null' ? null : button.dataset.value === 'true', shown()));
    if (button.dataset.zoom) {
      const next = Math.max(.2, Math.min(2.5, zoom * (Number(button.dataset.zoom) > 0 ? 1.2 : 1 / 1.2)));
      pan = { x: canvas.clientWidth / 2 - (canvas.clientWidth / 2 - pan.x) * next / zoom, y: canvas.clientHeight / 2 - (canvas.clientHeight / 2 - pan.y) * next / zoom };
      zoom = next;
      transform();
    }
    if (button.hasAttribute('data-center')) { fitGraph(); transform(); }
  });
  picker.addEventListener('change', () => { scope = Number(picker.value); selected = ''; paint(); });
  chooser.addEventListener('change', () => { assumed = {}; simulated = null; paintBanner(); reasoning = chooser.value; serialized = ''; scope = 0; selected = ''; void load(); });

  canvas.addEventListener('pointerdown', (event) => {
    if ((event.target as Element).closest('button') || event.button !== 0) return;
    drag = { id: (event.target as Element).closest<HTMLElement>('[data-node]')?.dataset.node ?? '', x: event.clientX, y: event.clientY, moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    pan.x += dx;
    pan.y += dy;
    drag.x = event.clientX;
    drag.y = event.clientY;
    transform();
  });
  canvas.addEventListener('pointerup', (event) => {
    if (drag && !drag.moved) { if (drag.id) select(drag.id); else if (selected) { selected = ''; highlight(); } }
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  stage.addEventListener('keydown', (event) => {
    const id = (event.target as Element).closest<HTMLElement>('[data-node]')?.dataset.node;
    if (id && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); select(id); }
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (!event.ctrlKey && !event.metaKey) { pan = { x: pan.x - event.deltaX, y: pan.y - event.deltaY }; transform(); return; }
    const box = canvas.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top;
    const next = Math.max(.2, Math.min(2.5, zoom * Math.exp(-event.deltaY / 200)));
    pan = { x: x - (x - pan.x) * next / zoom, y: y - (y - pan.y) * next / zoom };
    zoom = next;
    transform();
  }, { passive: false });

  const wide = () => getComputedStyle(workspace).flexDirection === 'row';
  const share = (value: number) => {
    const bounded = Math.min(0.85, Math.max(0.15, value));
    inspector.style.flex = `0 0 ${bounded * 100}%`;
    inspector.style.maxHeight = 'none';
    split.setAttribute('aria-valuenow', String(Math.round(bounded * 100)));
    try { localStorage.setItem('pmr-split-colonnes', String(bounded)); } catch {}
  };
  try { const saved = Number(localStorage.getItem('pmr-split-colonnes')); if (saved) share(saved); } catch {}
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

  const resize = new ResizeObserver(() => layoutGraph(!focusing));
  resize.observe(canvas);
  const unsubscribe = api.onContextChange((next) => {
    const changed = next.project?.path !== context.project?.path;
    context = next;
    if (changed) { sequence++; assumed = {}; simulated = null; paintBanner(); snapshot = null; reasoning = undefined; serialized = ''; scope = 0; selected = ''; shape = ''; void load(); }
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
