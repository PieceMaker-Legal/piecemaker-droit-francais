import type { ReasoningIssue, ReasoningLogEntry, ReasoningSnapshot } from '../../../shared/piecemaker-reasoning.js';
import { citeSource, dismissIssue, loadReasoning, ratePiece, runTest } from './api.js';
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
type Cell = { id: string; ref: string; parent: string; column: number; kind: Kind; x: number; y: number; w: number; h: number; path?: string; link?: 'si' | 'sauf'; member?: Json };
type Item = { key: string; status: string; html: string };
type Part = { cell: string; kind: string; title: string; nature: string; items: Item[] };

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
const KINDS: Record<Exclude<Kind, 'ou'>, [string, string]> = { question: ['Objectif', '◎'], terme: ['Droit', '⚖'], controle: ['Contrôle', '◆'], fait: ['Fait', '●'], conclusion: ['Conclusion', '✓'] };
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
const MONTHS: Record<string, string> = { janvier: 'janv.', février: 'févr.', mars: 'mars', avril: 'avr.', mai: 'mai', juin: 'juin', juillet: 'juil.', août: 'août', septembre: 'sept.', octobre: 'oct.', novembre: 'nov.', décembre: 'déc.' };
const CHAMBERS: Array<[RegExp, string]> = [[/commerciale/i, 'com.'], [/sociale/i, 'soc.'], [/criminelle/i, 'crim.'], [/civile\s*1|premi[eè]re chambre civile/i, 'civ. 1re'], [/civile\s*2|deuxi[eè]me chambre civile/i, 'civ. 2e'], [/civile\s*3|troisi[eè]me chambre civile/i, 'civ. 3e'], [/pl[ée]ni[èe]re/i, 'ass. plén.'], [/mixte/i, 'ch. mixte']];
const sourceName = (source: Json) => {
  const title = String(source.titre ?? source.source);
  const article = /^(?:(.+?),\s*)?articles?\s+(.+)$/i.exec(title);
  if (article) return `Art. ${article[2]}${article[1] ? /^code\b/i.test(article[1]) ? ` du ${article[1]}` : ` – ${article[1]}` : ''}`;
  const day = /(\d{1,2}(?:er)?)\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(\d{4})/i.exec(title);
  if (!day) return /[/\\]/.test(String(source.source)) && !source.titre ? basename(String(source.source)) : title;
  const court = /^cour de cassation/i.test(title) ? `Cass. ${CHAMBERS.find(([pattern]) => pattern.test(title))?.[1] ?? ''}`.trim() : /^conseil d.[ée]tat/i.test(title) ? 'CE' : /^cour d.appel d(?:e |')\s*([^,]+)/i.exec(title)?.[1].replace(/^/, 'CA ') ?? title.split(',')[0];
  const number = /\b(\d{2}-\d{2}\.\d{3}|\d{2}\/\d{5}|\d{6})\b/.exec(title)?.[1];
  return `${court}, ${day[1]} ${MONTHS[day[2].toLowerCase()]} ${day[3]}${number ? `, n° ${number}` : ''}`;
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
const SIDE = 72;
const STACK = 14;
const ROW = 64;
const cleanups = new WeakMap<HTMLElement, () => void>();

export function mount(container: HTMLElement, api: Host) {
  const style = document.createElement('style');
  style.textContent = STYLES;
  const root = document.createElement('section');
  root.className = 'pmr piecemaker-ui';
  root.setAttribute('aria-label', 'Raisonnement du dossier');
  root.innerHTML = `<header class="pmr-head"><div class="pmr-tabs" role="tablist" aria-label="Vue"><button role="tab" data-view="graph">Graphe</button><button role="tab" data-view="test">Vue écrite<span class="pmr-count" data-alerts hidden></span></button></div><select data-reasoning aria-label="Raisonnement" hidden></select><select data-scope aria-label="Objectif" hidden></select></header><div class="pmr-warning" hidden></div><div class="pmr-workspace"><div class="pmr-canvas" aria-label="Graphe du raisonnement"><div class="pmr-stage"></div><div class="pmr-empty" hidden></div><div class="pmr-legend" hidden>${(['question', 'terme', 'controle', 'conclusion'] as const).map((kind) => `<span><i style="background:${COLORS[kind]}"></i>${KINDS[kind][0]}</span>`).join('')}<span><b class="pmr-chip is-source">§ Source</b></span><span><b class="pmr-chip is-piece">Pièce</b></span><span><i style="background:${COLORS.fait}"></i>Fait prouvé</span><span><i style="background:#c45b5b"></i>Fait contraire</span><span><i class="is-dashed"></i>À établir</span><span><i class="is-sauf"></i>sauf</span></div><div class="pmr-tools"><button data-legend aria-pressed="false">Légende</button><button data-zoom="1" aria-label="Zoomer">+</button><button data-zoom="-1" aria-label="Dézoomer">−</button><button data-center>Ajuster</button><button class="pmr-primary" data-run-test>Lancer le test</button></div></div><div class="pmr-inspector"><div class="pmr-detail"></div></div></div>`;
  container.replaceChildren(style, root);
  const canvas = root.querySelector<HTMLElement>('.pmr-canvas')!;
  const stage = root.querySelector<HTMLElement>('.pmr-stage')!;
  const detail = root.querySelector<HTMLElement>('.pmr-detail')!;
  const warning = root.querySelector<HTMLElement>('.pmr-warning')!;
  const empty = root.querySelector<HTMLElement>('.pmr-empty')!;
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
  let selectedCell = '';
  let described = '';
  let focusing = '';
  let shape = '';
  let nodes: GraphNode[] = [];
  let edges: Edge[] = [];
  let steps: GraphNode[] = [];
  let cells: Cell[] = [];
  let ties: Edge[] = [];
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  let drag: { id: string; cell: string; x: number; y: number; moved: boolean } | null = null;
  let busy = false;
  let running = false;
  let live: ReasoningLogEntry[] | null = null;
  let played: Set<string> | null = null;
  let fresh: { key: string; added: boolean } | null = null;
  let pacing = 0;
  let unrolling = false;
  let stopped = false;
  let timer = 0;
  let sequence = 0;
  let legend = false;

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
  const full = () => (snapshot?.test?.log ?? []).filter((entry) => entry.status !== 'en cours');
  const log = () => live ?? snapshot?.test?.log ?? [];
  const met = (condition: Json): string => {
    if (Array.isArray(condition.l_une)) {
      const members = condition.l_une.map(met);
      return members.includes('acquis') ? 'acquis' : members.every((status: string) => status === 'exclu') ? 'exclu' : 'à établir';
    }
    return condition.statut ?? 'à établir';
  };
  const answerOf = (objective: Json) => objective.statut ?? 'à établir';

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
  const ruling = (term: Json | undefined) => (['si', 'sauf'] as const).flatMap((link) => term?.[link] ?? []).flatMap((condition: Json) => [condition, ...(condition.l_une ?? [])]).flatMap((item: Json) => item.selon ?? []) as Json[];
  const touches = (node: GraphNode, entry: ReasoningLogEntry) => {
    const prefixes = [...node.sources, ...(node.kind === 'fait' ? [] : ruling(terms()[node.id]))].map((source) => `source:${source.source}:`).concat(node.pieces.map((item) => `piece:${item.piece.piece}:`));
    return entry.key === `terme:${node.id}` || entry.key === `fait:${node.id}` || (node.kind === 'conclusion' && entry.key === `réponse:${scope}`) || prefixes.some((prefix) => entry.key.startsWith(prefix));
  };
  const entriesOf = (node: GraphNode) => log().filter((entry) => touches(node, entry));
  const issuesFor = (node: GraphNode) => issuesOf(node.kind === 'conclusion' || node.kind === 'question' ? [] : [node.id, ...occurrences().filter((entry) => entry.condition.condition === node.id).map((entry) => entry.path)]).filter((issue) => !dismissedIds().has(issue.id));
  const testMark = (node: GraphNode) => {
    const mine = entriesOf(node);
    return (!live && issuesFor(node).length) || mine.some((entry) => entry.status === 'alerte') ? 'alerte' : mine.some((entry) => entry.status === 'ok') ? 'ok' : '';
  };
  const hidden = (cell: string) => Boolean(played && !played.has(cell));

  const buildGraph = () => {
    nodes = [];
    edges = [];
    steps = [];
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
    const amount = objective.montant_calcule;
    nodes.push(node('#question', objective.objectif, answered, 'question'));
    nodes.push(node('#conclusion', 'montant_calcule' in objective ? amountText(amount) : ANSWER[answered] ?? 'En suspens', answered, 'conclusion'));
    for (const name of order) {
      const occurrence = list.find((item) => item.condition.condition === name);
      const term = all[name];
      nodes.push(node(name, human(name), term ? term.statut ?? 'à établir' : occurrence?.condition.statut ?? 'à établir', term ? (isControl(name) ? 'controle' : term.true || term.false ? 'fait' : 'terme') : 'fait', Boolean(occurrence?.condition.decisif)));
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
    for (const item of nodes.filter((entry) => entry.kind !== 'question' && entry.kind !== 'conclusion' && !edges.some((edge) => edge.from === entry.id))) edges.push({ from: item.id, to: '#conclusion', link: 'si' });
    if (selected && !byId.has(selected)) { selected = ''; selectedCell = ''; }
    const layer = layering();
    steps = nodes.filter((item) => item.kind === 'terme' || item.kind === 'controle').reverse().sort((one, other) => layer.get(other.id)! - layer.get(one.id)!);
  };

  const sourceChip = (source: Json) => `<button class="pmr-chip is-source${source.en_vigueur === false ? ' is-against' : ''}" data-show="#source:${escape(source.source)}" data-quote="${escape(source.citation ?? '')}" title="${escape(String(source.titre ?? source.source))}">§ ${escape(sourceName(source))}</button>`;
  const stepRef = (id: string) => `<button class="pmr-link" data-select="${escape(id)}">Étape ${steps.findIndex((step) => step.id === id) + 1} · ${escape(nodes.find((node) => node.id === id)?.label ?? human(id))}</button>`;
  const clause = (path: string, link: Occurrence['link'], condition: Json, members: Json[]) => {
    const sources = [condition, ...(members.length > 1 ? members : [])].flatMap((item: Json) => item.selon ?? []) as Json[];
    const chips = [...new Map(sources.map((source) => [source.source, source])).values()].map(sourceChip);
    const quotes = [...new Set(sources.map((source) => String(source.citation ?? '')).filter(Boolean))].map((text) => `<q>${escape(shorten(text, 240))}</q>`);
    const owned = members.filter((member) => steps.some((step) => step.id === member.condition)).map((member) => `<span class="pmr-needs">${stepRef(member.condition)}</span>`);
    const controls = [...new Set(sources.flatMap((source) => [source.applicabilite, source.validite]).concat(members.map((member) => member.decompte)).filter((name): name is string => typeof name === 'string' && steps.some((step) => step.id === name)))].map((name) => `<span class="pmr-needs is-control">${name.startsWith('décompte') ? 'Décompte' : name.startsWith('validité') ? 'Valable si' : 'Applicable si'} : ${stepRef(name)}</span>`);
    const fill = met(condition);
    const tone = link === 'sauf' ? { acquis: 'ko', exclu: 'ok' }[fill] ?? 'warn' : TONE[fill] ?? 'warn';
    const label = link === 'sauf' ? { ok: 'Exception écartée', ko: 'Exception établie' }[tone] ?? 'À établir' : { ok: 'Remplie', ko: 'Non remplie' }[tone] ?? 'À établir';
    const title = `${link === 'sauf' ? 'Sauf' : 'Si'}${members.length > 1 ? ' l’une des conditions' : ''}`;
    const owner = path.split('.')[0];
    const id = `#clause:${path}`;
    return `<div class="pmr-box pmr-loi is-${tone}${hidden(id) ? ' is-waiting' : ''}${played && fresh?.key === id ? ' is-arriving' : ''}" data-id="${escape(id)}" data-node="${escape(owner)}" tabindex="0" role="button" aria-label="${escape(`${title} : ${quotes.length ? sources[0].citation : ''}`)}"><div class="pmr-box-body"><span class="pmr-kind">${title}</span>${chips.length ? `<div class="pmr-chips">${chips.join('')}</div>` : ''}${quotes.join('')}${owned.join('')}${controls.join('')}<div class="pmr-foot">${pill({ ok: 'acquis', ko: 'exclu' }[tone] ?? 'à établir', label)}</div></div></div>`;
  };

  const verdict = () => {
    const answer = log().find((entry) => entry.key === `réponse:${scope}`);
    if (!answer) return '';
    const alerts = log().filter((entry) => entry.status === 'alerte').length;
    return `<div class="pmr-verdict"><span class="pmr-kind">Résultat du test</span><p>${escape(answer.text)}</p>${pill(alerts ? 'exclu' : 'acquis', alerts ? plural(alerts, 'alerte') : 'aucune alerte')}</div>`;
  };
  const judged = (entry: ReasoningLogEntry): [string, string] => {
    if (entry.step === 'source' || entry.step === 'pièce') return entry.status === 'ok' ? ['acquis', 'Vérifié'] : entry.status === 'alerte' ? ['exclu', 'Erreur'] : ['à établir', 'Non vérifiable'];
    if (entry.step === 'fait') return entry.status === 'ok' ? ['acquis', 'Établi'] : entry.status === 'alerte' ? ['exclu', 'Manque décisif'] : ['à établir', 'Manque'];
    return entry.status === 'alerte' ? ['exclu', 'Erreur'] : entry.status === 'ok' ? ['acquis', 'Calculé'] : ['à établir', 'À établir'];
  };
  const line = (key: string, status: string, head: string, text: string, extra = '') => ({ key, status, html: `<li data-status="${escape(status)}"${fresh?.key === key ? ' class="is-new"' : ''}><span class="pmr-mark" aria-hidden="true">${{ ok: '✓', alerte: '!', erreur: '!' }[status] ?? '?'}</span><div><div class="pmr-entry-head">${head}</div><p>${escape(text)}</p>${extra}</div></li>` });
  const entryItem = (entry: ReasoningLogEntry, self = '') => { const [tone, label] = judged(entry); return line(entry.key, entry.status, `${pill(tone, label)}<span class="pmr-step">${escape(STEP[entry.step])}</span>${subject(entry, self)}`, entry.text, rating(entry)); };
  const issueItem = (issue: ReasoningIssue): Item => ({ key: `issue:${issue.id}`, status: issue.kind === 'erreur' ? 'erreur' : 'manque', html: `<li class="is-issue${fresh?.key === `issue:${issue.id}` ? ' is-new' : ''}">${issueList([issue], false, true)}</li>` });
  const lookupEntry = (prefix: string, citation: unknown) => { const found = full().filter((entry) => entry.key.startsWith(prefix)); return found.find((entry) => entry.key === `${prefix}${citation}`) ?? (found.length === 1 ? found[0] : found.find((entry) => String(citation ?? '').startsWith(entry.key.slice(prefix.length)))); };
  const absent = (key: string, what: string, text: string) => line(key, 'neutre', `${pill('à établir', 'Non vérifié')}<span class="pmr-step">${escape(what)}</span>`, text);
  const sourceItems = (sources: Json[], owner: string) => [...new Map(sources.map((source) => [`${source.source}:${source.citation}`, source])).values()].flatMap((source) => {
    const entry = lookupEntry(`source:${source.source}:`, source.citation);
    return entry ? [entryItem(entry)] : snapshot?.test ? [absent(`absent:${owner}:${source.source}`, 'Source', `${sourceName(source)} : le test n’a pas consulté ce texte.`)] : [];
  });
  const pieceItems = (pieces: Cited[], owner: string) => pieces.flatMap((cited) => {
    const entry = lookupEntry(`piece:${cited.piece.piece}:`, cited.piece.citation);
    return entry ? [entryItem(entry)] : snapshot?.test ? [absent(`absent:${owner}:${cited.piece.piece}`, 'Pièce', `${cited.piece.titre ?? basename(cited.piece.piece)} : le test n’a pas relu cette pièce.`)] : [];
  });
  const open = (list: ReasoningIssue[]) => list.filter((issue) => !dismissedIds().has(issue.id)).map(issueItem);
  const lawPart = (cell: Cell): Part => {
    const group = groups().find((item) => item.path === cell.path)!;
    const members: Json[] = Array.isArray(group.condition.l_une) ? group.condition.l_une : [group.condition];
    const sources = [group.condition, ...(members.length > 1 ? members : [])].flatMap((item: Json) => item.selon ?? []) as Json[];
    const fill = met(group.condition);
    const sauf = cell.link === 'sauf';
    const result = sauf ? { acquis: 'Exception établie : ses faits sont prouvés.', exclu: 'Exception écartée : un de ses faits est contredit.' }[fill] : { acquis: 'Condition remplie : ses faits sont établis.', exclu: 'Condition non remplie : un de ses faits est contredit.' }[fill];
    const state = line(`état:${cell.path}`, result ? 'ok' : 'neutre', `${pill(result ? 'acquis' : 'à établir', result ? 'Calculé' : 'À établir')}<span class="pmr-step">Condition</span>`, result ?? 'À établir : un fait reste à prouver.');
    return { cell: cell.id, kind: `Condition · ${sauf ? 'Sauf' : 'Si'}${members.length > 1 ? ' l’une des conditions' : ''}`, title: sources.length ? [...new Set(sources.map(sourceName))].join(', ') : 'Sans texte cité', nature: sources.length ? 'Le test consulte le texte officiel : il vérifie qu’il existe, qu’il contient la citation et qu’il est en vigueur. Il calcule ensuite si la condition est remplie.' : 'Aucun texte n’est cité pour cette condition : le test calcule seulement si elle est remplie.', items: [...open(issuesOf([cell.path!])), ...sourceItems(sources, cell.id), state] };
  };
  const factPart = (cell: Cell): Part => {
    const node = nodes.find((item) => item.id === cell.ref)!;
    const term = terms()[node.id];
    const sources = sides.flatMap((side) => term?.[side] ?? []).flatMap((entry: Json) => entry.selon ?? []) as Json[];
    const entry = full().find((item) => item.key === `fait:${node.id}`);
    const result = entry ? [entryItem(entry, node.id)] : snapshot?.test ? [absent(`absent:${cell.id}`, 'Fait', 'Le test n’a pas évalué ce fait.')] : [];
    return { cell: cell.id, kind: 'Fait', title: node.label, nature: node.pieces.length ? 'Le test ouvre chaque pièce citée et y cherche la citation. Le fait est établi si une pièce fiable la contient.' : sources.length ? 'Le fait repose sur un texte : le test vérifie ce texte et sa citation.' : 'Aucune pièce ni aucun texte n’est cité : le fait ne peut pas être établi.', items: [...open(issuesFor(node)), ...(node.pieces.length || sources.length ? [] : [line(`sans-preuve:${cell.id}`, 'manque', `${pill('à établir', 'Manque')}<span class="pmr-step">Preuve</span>`, 'Aucune pièce citée pour prouver ce fait.')]), ...pieceItems(node.pieces, cell.id), ...sourceItems(sources, cell.id), ...result] };
  };
  const stepPart = (cell: Cell): Part => {
    const node = nodes.find((item) => item.id === cell.ref)!;
    const inner = groups().filter((group) => group.parent === node.id).map((group) => group.path);
    const entry = full().find((item) => item.key === `terme:${node.id}`);
    const result = entry ? [entryItem(entry, node.id)] : snapshot?.test ? [absent(`absent:${cell.id}`, 'Étape', 'Le test n’a pas calculé cette étape.')] : [];
    return { cell: cell.id, kind: `Étape ${steps.indexOf(node) + 1}`, title: node.label, nature: 'Le test calcule l’étape : elle est remplie si toutes ses conditions « si » le sont et qu’aucune exception « sauf » n’est établie.', items: [...open(issuesOf([node.id]).filter((issue) => !inner.some((path) => issue.path === path || issue.path.startsWith(`${path}.`)))), ...result] };
  };
  const answerPart = (cell: Cell): Part => {
    const entry = full().find((item) => item.key === `réponse:${scope}`);
    return { cell: cell.id, kind: 'Réponse', title: nodes.find((item) => item.id === '#conclusion')?.label ?? '', nature: 'Le test déduit la réponse des étapes : elle n’est acquise que si les étapes décisives le sont.', items: entry ? [entryItem(entry)] : [] };
  };
  const sections = (id: string): Part[] => {
    const cell = cells.find((item) => item.id === id);
    if (!cell || cell.kind === 'question') return [];
    if (cell.kind === 'conclusion') return [answerPart(cell)];
    if (cell.member) return [factPart(cell)];
    if (cell.path) return [lawPart(cell)];
    if (cell.kind === 'fait') return [factPart(cell)];
    const below = cells.filter((item) => item.parent === cell.id || cells.some((parent) => parent.id === item.parent && parent.parent === cell.id));
    return [stepPart(cell), ...below.map((item) => item.member ? factPart(item) : lawPart(item))];
  };
  const tally = (items: Item[]) => items.some((item) => ['alerte', 'erreur'].includes(item.status)) ? pill('exclu', 'Erreur') : items.some((item) => ['neutre', 'manque'].includes(item.status)) ? pill('à établir', 'Incomplet') : items.length ? pill('acquis', 'Vérifié') : '';
  const note = (cell: Cell) => {
    const parts = sections(cell.id).filter((part) => !hidden(part.cell));
    if (!parts.length) return '';
    const body = parts.map((part) => {
      const items = part.items.filter((item) => !played || played.has(item.key));
      return `<section class="pmr-note-part${fresh?.key === part.cell ? ' is-new' : ''}${part.cell === described ? ' is-described' : ''}" data-cell="${escape(part.cell)}"><header><span class="pmr-kind">${escape(part.kind)}</span>${tally(items)}</header><strong>${escape(part.title)}</strong><p class="pmr-nature">${escape(part.nature)}</p>${items.length ? `<ul>${items.map((item) => item.html).join('')}</ul>` : part.items.length ? '' : `<p class="pmr-muted">${snapshot?.test ? 'Rien à vérifier ici.' : 'Pas encore vérifié.'}</p>`}</section>`;
    }).join('');
    const anchor = cells.find((item) => item.id === described) ?? cell;
    return `<aside class="pmr-note" style="left:${anchor.x + anchor.w / 2 + 48}px;top:${anchor.y}px"><span class="pmr-kind">Vérification</span>${snapshot?.test ? '' : '<p class="pmr-muted">Test pas encore lancé : seuls les calculs et les défauts d’écriture sont affichés.</p>'}${body}</aside>`;
  };

  const box = (node: GraphNode, id = node.id, own?: { condition: Json; sauf: boolean }) => {
    const state = `${hidden(id) ? ' is-waiting' : ''}${played && fresh?.key === id ? ' is-arriving' : ''}`;
    const [kind, icon] = KINDS[node.kind as Exclude<Kind, 'ou'>];
    const objective = objectives()[scope] ?? {};
    const mark = testMark(node);
    const term = terms()[node.id];
    const facts = node.kind === 'fait' && !(term?.si?.length || term?.sauf?.length);
    const chips = [
      ...(facts ? sides.flatMap((side) => term?.[side] ?? []).flatMap((entry: Json) => entry.selon ?? []) : []).map(sourceChip),
      ...node.pieces.map((entry) => `<button class="pmr-chip is-piece${entry.against ? ' is-against' : ''}" data-show="#piece:${escape(entry.piece.piece)}" title="${escape(`${entry.against ? 'Contredit par' : 'Prouvé par'} ${entry.piece.titre ?? entry.piece.piece}\n« ${entry.piece.citation ?? ''} »`)}">${escape(shorten(String(entry.piece.titre ?? basename(entry.piece.piece)), 40))}</button>`),
    ];
    const decisifs = Array.isArray(objective.decisifs) ? objective.decisifs as string[] : [];
    const occurrence = occurrences().find((entry) => entry.condition.condition === node.id);
    const fill = own ? met(own.condition) : occurrence ? met(occurrence.condition) : node.status;
    const tone = (own ? own.sauf : occurrence?.path.includes('.sauf[')) ? { acquis: 'ko', exclu: 'ok' }[fill] ?? 'warn' : TONE[fill] ?? 'warn';
    const numbered = steps.includes(node) ? `<span class="pmr-kind">Étape ${steps.indexOf(node) + 1}${node.kind === 'controle' ? ` · ${kind}` : ''}</span>` : '';
    const status = node.kind === 'fait' ? pill({ ok: 'acquis', ko: 'exclu' }[tone] ?? 'à établir', { ok: 'Condition remplie', ko: 'Condition non remplie' }[tone] ?? 'À établir') : pill(node.status, STATUS[node.status] ?? 'À établir');
    const body = node.kind === 'question'
      ? `<span class="pmr-kind">${kind}</span><strong class="pmr-editorial">${escape(node.label)}</strong>`
      : node.kind === 'conclusion'
        ? `<span class="pmr-kind">${kind}</span><strong>Réponse : ${escape(node.label)}</strong>${decisifs.length ? `<p class="pmr-sub">Dépend de : ${decisifs.map((name) => escape(human(name))).join(', ')}</p>` : ''}${verdict()}`
        : numbered
          ? `${numbered}<strong class="pmr-ruled">${escape(node.label)}</strong>${typeof term?.but === 'string' ? `<p class="pmr-aim">${escape(term.but)}</p>` : ''}<div class="pmr-foot">${status}${node.decisive ? '<span class="pmr-pill pmr-accent">décisif</span>' : ''}</div>`
          : `<span class="pmr-kind">${kind}</span><strong>${escape(node.label)}</strong>${chips.length ? `<div class="pmr-chips">${chips.join('')}</div>` : ''}<div class="pmr-foot">${status}${node.decisive ? '<span class="pmr-pill pmr-accent">décisif</span>' : ''}</div>`;
    const uncertain = ['terme', 'controle', 'conclusion'].includes(node.kind) && ['à établir', 'disputé'].includes(node.status);
    return `<div class="pmr-box pmr-${node.kind}${state}${node.kind === 'fait' ? ` is-${tone}` : ''}${uncertain ? ' is-uncertain' : ''}${(node.kind === 'fait' ? fill : node.status) === 'exclu' && node.kind !== 'question' ? ' is-excluded' : ''}" data-id="${escape(id)}" data-node="${escape(node.id)}" tabindex="0" role="button" aria-label="${escape(`${kind} : ${node.label}`)}"><span class="pmr-icon" aria-hidden="true">${icon}</span><div class="pmr-box-body">${body}</div>${mark ? `<span class="pmr-test is-${mark}" title="${mark === 'ok' ? 'Vérifié par le test' : 'Alerte : voir le test'}">${MARK[mark]}</span>` : ''}</div>`;
  };

  const layering = () => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
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
    layer.set('#conclusion', Math.max(...layer.values()) + 1);
    return layer;
  };

  const bound = (value: number, low: number, high: number, size: number) => {
    const start = 20 - low * zoom, end = size - 20 - high * zoom;
    return Math.min(Math.max(start, end), Math.max(Math.min(start, end), value));
  };
  const transform = () => {
    const placed = cells.filter((cell) => cell.w);
    const aside = stage.querySelector<HTMLElement>('.pmr-note');
    if (placed.length) {
      const left = Math.min(...placed.map((node) => node.x - node.w / 2)), top = Math.min(...placed.map((node) => node.y));
      const right = Math.max(...placed.map((node) => node.x + node.w / 2), aside ? aside.offsetLeft + aside.offsetWidth : -Infinity);
      const bottom = Math.max(...placed.map((node) => node.y + node.h), aside ? aside.offsetTop + aside.offsetHeight : -Infinity);
      pan = { x: bound(pan.x, left, right, canvas.clientWidth), y: bound(pan.y, top, bottom, canvas.clientHeight - 44) };
    }
    stage.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  };
  const fitGraph = () => {
    const placed = cells.filter((cell) => cell.w);
    if (!placed.length) return;
    const minX = Math.min(...placed.map((node) => node.x - node.w / 2)), maxX = Math.max(...placed.map((node) => node.x + node.w / 2));
    const minY = Math.min(...placed.map((node) => node.y)), maxY = Math.max(...placed.map((node) => node.y + node.h));
    const width = canvas.clientWidth, height = canvas.clientHeight;
    zoom = Math.min(1, Math.max(.75, (width - 40) / (maxX - minX)));
    pan = { x: Math.max(20, (width - (maxX - minX) * zoom) / 2) - minX * zoom, y: Math.max(20, (height - 44 - (maxY - minY) * zoom) / 2) - minY * zoom };
  };
  const center = (id: string) => {
    const node = nodes.find((item) => item.id === id);
    if (!node) return;
    pan = { x: canvas.clientWidth / 2 - node.x * zoom, y: canvas.clientHeight / 2 - (node.y + node.h / 2) * zoom };
  };
  const tether = (aside: HTMLElement | null | undefined) => {
    const card = cells.find((item) => item.id === described);
    if (!aside || !card) return;
    const part = aside.querySelector<HTMLElement>(`[data-cell="${CSS.escape(described)}"]`);
    const top = aside.offsetTop, bottom = top + aside.offsetHeight;
    const y = Math.min(bottom - 14, Math.max(top + 14, top + (part ? part.offsetTop - aside.scrollTop + 18 : 18)));
    const from = { x: card.x + card.w / 2, y: card.y + card.h / 2 }, to = aside.offsetLeft;
    stage.insertAdjacentHTML('beforeend', `<svg class="pmr-wires pmr-tether" aria-hidden="true"><path d="M${from.x} ${from.y} C${from.x + 40} ${from.y} ${to - 40} ${y} ${to} ${y}"/><circle cx="${from.x}" cy="${from.y}" r="3.5"/></svg>`);
  };
  const highlight = () => {
    stage.querySelectorAll('.pmr-note, .pmr-tether').forEach((element) => element.remove());
    const cell = cells.find((item) => item.id === selectedCell);
    if (cell) stage.insertAdjacentHTML('beforeend', note(cell));
    const aside = stage.querySelector<HTMLElement>('.pmr-note');
    const newest = aside?.querySelector<HTMLElement>('.is-new:last-of-type, li.is-new');
    if (aside && newest) aside.scrollTop = Math.max(0, newest.offsetTop + newest.offsetHeight - aside.clientHeight + 8);
    tether(aside);
    stage.querySelectorAll<HTMLElement>('[data-id]').forEach((element) => element.classList.toggle('is-described', Boolean(aside) && element.dataset.id === described));
    const members = selected && !played ? branch(selected).add('#question') : null;
    stage.querySelectorAll<HTMLElement>('[data-node]').forEach((element) => { element.classList.toggle('is-selected', element.dataset.node === selected); element.classList.toggle('is-dim', Boolean(members && !members.has(element.dataset.node!))); });
    stage.querySelectorAll<SVGElement>('[data-from]').forEach((element) => { const lit = Boolean(members?.has(element.dataset.from!) && members.has(element.dataset.to!)); element.classList.toggle('is-lit', lit); element.classList.toggle('is-dim', Boolean(members && !lit)); });
  };

  const layoutGraph = (refit = false) => {
    if (!canvas.clientWidth || !cells.length) return;
    const byCell = new Map(cells.map((cell) => [cell.id, cell]));
    stage.querySelectorAll<HTMLElement>('[data-id]').forEach((element) => {
      const cell = byCell.get(element.dataset.id!);
      if (!cell) return;
      cell.w = element.offsetWidth;
      cell.h = element.offsetHeight;
    });
    const widths = [0, 1, 2].map((index) => Math.max(0, ...cells.filter((cell) => cell.column === index).map((cell) => cell.w)));
    const lefts = [0, widths[0] + SIDE, widths[0] + widths[1] + 2 * SIDE];
    const place = (cell: Cell, y: number) => { cell.y = y; cell.x = cell.column ? lefts[cell.column] + cell.w / 2 : widths[0] / 2; };
    const settle = (cell: Cell, y: number): number => {
      place(cell, y);
      let next = y;
      for (const child of cells.filter((item) => item.parent === cell.id)) next = settle(child, next) + STACK;
      return Math.max(y + cell.h, next - STACK);
    };
    let top = 0;
    for (const cell of cells.filter((item) => !item.parent)) top = settle(cell, top) + ROW;
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const seen = new Set<string>();
    for (const cell of cells) { const node = byId.get(cell.ref); if (node && !seen.has(cell.ref)) { seen.add(cell.ref); Object.assign(node, { x: cell.x, y: cell.y, w: cell.w, h: cell.h }); } }
    stage.querySelectorAll<HTMLElement>('[data-id]').forEach((element) => { const cell = byCell.get(element.dataset.id!); if (cell) { element.style.left = `${cell.x - cell.w / 2}px`; element.style.top = `${cell.y}px`; } });
    const markers = Object.entries(COLORS).map(([kind, color]) => `<marker id="pmr-arrow-${kind}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill="${color}"/></marker>`).join('');
    const wires = ties.map((tie) => {
      const a = byCell.get(tie.from)!, b = byCell.get(tie.to)!;
      const down = a.column === b.column;
      const [x1, y1, x2, y2] = down ? [a.x, a.y + a.h, b.x, b.y - 2] : [a.x + a.w / 2, a.y + Math.min(a.h / 2, 22), b.x - b.w / 2 - 2, b.y + Math.min(b.h / 2, 22)];
      const bend = Math.max(Math.abs(down ? y2 - y1 : x2 - x1) / 2, 18);
      const d = down ? `M${x1} ${y1} C${x1} ${y1 + bend} ${x2} ${y2 - bend} ${x2} ${y2}` : `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`;
      return `<path class="pmr-wire${tie.link === 'sauf' ? ' is-sauf' : ''}${hidden(a.id) || hidden(b.id) ? ' is-waiting' : ''}" data-from="${escape(a.ref)}" data-to="${escape(b.ref)}" stroke="${COLORS[a.kind]}" marker-end="url(#pmr-arrow-${a.kind})" d="${d}"/>`;
    }).join('');
    stage.querySelector('svg')!.innerHTML = `<defs>${markers}</defs>${wires}`;
    const key = nodes.map((node) => node.id).join('|');
    if (refit || key !== shape) { shape = key; fitGraph(); }
    if (focusing) { center(focusing); focusing = ''; }
    transform();
    highlight();
  };
  const plan = () => {
    cells = [];
    ties = [];
    const parts: string[] = [];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    if (!byId.has('#question')) return '';
    const add = (id: string, ref: string, parent: string, column: number, kind: Kind, html: string, extra: Partial<Cell> = {}) => { cells.push({ id, ref, parent, column, kind, x: 0, y: 0, w: 0, h: 0, ...extra }); parts.push(html); };
    const spine = (node: GraphNode) => {
      const last = cells.filter((cell) => !cell.parent).pop();
      add(node.id, node.id, '', 0, node.kind, box(node));
      if (last) ties.push({ from: last.id, to: node.id, link: 'si' });
    };
    spine(byId.get('#question')!);
    for (const step of steps) {
      spine(step);
      for (const group of groups().filter((item) => item.parent === step.id)) {
        const link = group.path.includes('.sauf[') ? 'sauf' : 'si';
        const members: Json[] = Array.isArray(group.condition.l_une) ? group.condition.l_une : [group.condition];
        const facts = members.filter((member) => byId.has(member.condition) && !steps.some((other) => other.id === member.condition));
        const ruled = members.length > 1 || facts.length < members.length || [group.condition, ...members].some((item) => item.selon?.length || typeof item.decompte === 'string');
        const anchor = ruled ? `#clause:${group.path}` : step.id;
        if (ruled) { add(anchor, step.id, step.id, 1, 'terme', clause(group.path, link, group.condition, members), { path: group.path, link }); ties.push({ from: step.id, to: anchor, link }); }
        facts.forEach((member, index) => {
          const id = `#fait:${group.path}:${index}`;
          add(id, member.condition, anchor, ruled ? 2 : 1, 'fait', box(byId.get(member.condition)!, id, { condition: member, sauf: link === 'sauf' }), { path: group.path, link, member });
          ties.push({ from: anchor, to: id, link: ruled ? 'si' : link });
        });
      }
    }
    for (const node of nodes.filter((item) => !['question', 'conclusion', 'ou'].includes(item.kind) && !cells.some((cell) => cell.ref === item.id))) spine(node);
    spine(byId.get('#conclusion')!);
    return parts.join('');
  };
  const paintGraph = () => {
    stage.classList.toggle('is-following', Boolean(played));
    stage.innerHTML = `<svg class="pmr-wires" aria-hidden="true"></svg>${plan()}`;
    layoutGraph();
  };

  const issueList = (list: ReasoningIssue[], restore = false, inGraph = false) => {
    const twins = (issue: ReasoningIssue) => issue.avocat ? (snapshot?.issues ?? []).filter((other) => other.kind === issue.kind && other.avocat === issue.avocat && dismissedIds().has(other.id) === restore) : [issue];
    const dismiss = (...issues: ReasoningIssue[]) => (snapshot?.demo ? '' : `<button data-dismiss="${escape([...new Set(issues.flatMap(twins).map((issue) => issue.id))].join(' '))}"${restore ? ' data-restore' : ' title="L’alerte quitte le compteur et va dans « Ignorées par vous », où vous pouvez la rétablir."'}>${restore ? 'Rétablir' : 'Ignorer'}</button>`);
    const technical = (issue: ReasoningIssue) => `<code>${escape(issue.text)} · ${escape(issue.path || 'fichier')}${issue.line ? ` · ligne ${issue.line}` : ''}</code>`;
    const open = (target: string) => /^#(piece|source):/.test(target) ? `<button data-show="${escape(target)}">${target.startsWith('#piece:') ? 'Ouvrir la pièce' : 'Ouvrir le texte'}</button>` : inGraph ? '' : `<button data-select="${escape(target)}">Voir dans le graphe</button>`;
    const groups = new Map<string, ReasoningIssue[]>();
    for (const issue of list.filter((issue) => issue.avocat)) groups.set(`${issue.kind}\0${issue.avocat}`, [...groups.get(`${issue.kind}\0${issue.avocat}`) ?? [], issue]);
    const readable = [...groups.values()].map((same) => { const [issue] = same; return `<div class="pmr-issue">${pill(issue.kind === 'erreur' ? 'exclu' : 'à établir', issue.kind === 'erreur' ? 'Erreur · à corriger' : 'Manque · à compléter')}<div class="pmr-issue-body"><p>${escape(issue.avocat)}</p><details><summary>Détail technique</summary>${same.map(technical).join('<br>')}</details></div><span class="pmr-decision">${issue.cible ? open(issue.cible) : ''}${dismiss(...same)}</span></div>`; });
    const drafting = list.filter((issue) => !issue.avocat);
    const agent = drafting.length ? `<div class="pmr-issue">${pill('exclu', 'Rédaction')}<div class="pmr-issue-body"><p>${plural(drafting.length, 'défaut')} d’écriture du raisonnement. Rien à décider : demandez à l’agent de relancer la vérification, il les corrigera.</p><details><summary>Détail technique</summary>${drafting.map((issue) => `<p>${technical(issue)} ${dismiss(issue)}</p>`).join('')}</details></div></div>` : '';
    return readable.join('') + agent;
  };

  const rating = (entry: ReasoningLogEntry) => {
    if (snapshot?.demo || entry.step !== 'pièce' || entry.status === 'en cours') return '';
    const file = entry.key.split(':')[1];
    const reliable = cited().find((item) => item.piece.piece === file)?.piece.fiable;
    return `<span class="pmr-decision"><button data-rate="${escape(file)}" data-value="true"${reliable === true ? ' disabled' : ''}>Fiable</button><button data-rate="${escape(file)}" data-value="false"${reliable === false ? ' disabled' : ''}>Non fiable</button>${reliable === null || reliable === undefined ? '' : `<button data-rate="${escape(file)}" data-value="null">Annuler</button>`}</span>`;
  };
  const subject = (entry: ReasoningLogEntry, self = '') => {
    if ((entry.step === 'source' || entry.step === 'pièce') && entry.status !== 'en cours') return `<button class="pmr-link" data-show="#${entry.step === 'source' ? 'source' : 'piece'}:${escape(entry.key.split(':')[1])}" data-quote="${escape(entry.key.split(':').slice(2).join(':'))}"><strong>${escape(entry.subject)}</strong></button>`;
    const name = /^(fait|terme):(.+)$/.exec(entry.key)?.[2];
    return name && name !== self && nodes.some((node) => node.id === name) ? `<button class="pmr-link" data-select="${escape(name)}"><strong>${escape(entry.subject)}</strong></button>` : `<strong>${escape(entry.subject)}</strong>`;
  };
  const paintTest = () => {
    const entries = log();
    const view = (entry: ReasoningLogEntry) => `<li class="pmr-entry${fresh?.key === entry.key ? fresh.added ? ' is-new' : ' is-updated' : ''}" data-step="${escape(entry.step)}" data-status="${escape(entry.status)}"><span class="pmr-mark" aria-hidden="true">${MARK[entry.status]}</span><div class="pmr-entry-head"><span class="pmr-step">${escape(entry.status === 'ok' && entry.step === 'source' ? 'Source vérifiée' : entry.status === 'ok' && entry.step === 'pièce' ? 'Pièce et citation vérifiées' : STEP[entry.step])}</span>${subject(entry)}</div><span class="pmr-entry-text">${escape(entry.text)}</span>${rating(entry)}</li>`;
    const used = new Set<string>();
    const placed = new Set<string>();
    const rows = (list: ReasoningLogEntry[]) => { list.forEach((entry) => used.add(entry.key)); return list.length ? `<ol class="pmr-log" aria-live="polite">${list.map(view).join('')}</ol>` : ''; };
    const own = (id: string) => entries.filter((entry) => entry.key === `terme:${id}` || entry.key === `fait:${id}`);
    const unplaced = (list: ReasoningIssue[]) => list.filter((issue) => !placed.has(issue.id) && placed.add(issue.id));
    const feeds = (child: string, parent: string) => edges.some((edge) => edge.from === child && (edge.to === parent || (edge.to.startsWith('#ou:') && edges.some((up) => up.from === edge.to && up.to === parent))));
    const named = (id: string) => {
      const index = steps.findIndex((step) => step.id === id);
      return `<button class="pmr-link" data-select="${escape(id)}">${escape(nodes.find((item) => item.id === id)?.label ?? id)}</button>${index < 0 ? '' : ` (étape ${index + 1})`}`;
    };
    const namedGroup = (id: string) => id.startsWith('#ou:') ? `au choix : ${edges.filter((edge) => edge.to === id && edge.link === 'l_une').map((edge) => named(edge.from)).join(' ou ')}` : named(id);
    const rule = (node: GraphNode) => {
      const direct = edges.filter((edge) => edge.to === node.id);
      const into = [...direct, ...direct.filter((edge) => edge.from.startsWith('#ou:')).flatMap((group) => edges.filter((edge) => edge.to === group.from && edge.link !== 'l_une').map((edge) => ({ ...edge, link: group.link })))];
      const needs = into.filter((edge) => edge.link !== 'sauf').map((edge) => namedGroup(edge.from));
      const unless = into.filter((edge) => edge.link === 'sauf').map((edge) => namedGroup(edge.from));
      const serves = edges.filter((edge) => edge.from === node.id).flatMap((edge) => edge.to.startsWith('#ou:') ? edges.filter((up) => up.from === edge.to).map((up) => up.to) : [edge.to]).map((id) => id === '#conclusion' ? 'la réponse' : named(id));
      const list = (items: string[]) => `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
      const when = needs.length ? `<p>Remplie si :</p>${list(needs)}` : '';
      const except = unless.length ? `<p>Sauf :</p>${list(unless)}` : '';
      const why = `<p>Sert à établir ${serves.length ? serves.join(' et ') : 'la réponse'}.</p>`;
      return `<div class="pmr-phase-rule">${when}${except}${why}</div>`;
    };
    const stage = (node: GraphNode) => {
      const mine = entriesOf(node);
      const facts = nodes.filter((child) => child.kind === 'fait' && feeds(child.id, node.id)).map((child) => ({ child, head: own(child.id), proofs: entriesOf(child).filter((entry) => (entry.step === 'source' || entry.step === 'pièce') && !mine.some((other) => other.key === entry.key)), issues: issuesFor(child) }));
      const issues = [...issuesFor(node), ...facts.flatMap((fact) => fact.issues)];
      const all = [...mine, ...facts.flatMap((fact) => [...fact.head, ...fact.proofs])];
      if (!all.length && !issues.length) return '';
      const head = own(node.id);
      const status = issues.length || all.some((entry) => entry.status === 'alerte') ? 'alerte' : all.some((entry) => entry.status === 'en cours') ? 'en cours' : !head.length ? 'neutre' : node.status === 'acquis' ? 'ok' : node.status === 'exclu' ? 'neutre' : 'attente';
      head.forEach((entry) => used.add(entry.key));
      const law = rows(mine.filter((entry) => entry.step === 'source' && ruling(terms()[node.id]).some((source) => entry.key.startsWith(`source:${source.source}:`))));
      const pieces = rows(mine.filter((entry) => entry.step === 'pièce'));
      facts.forEach((fact) => fact.head.forEach((entry) => used.add(entry.key)));
      const proved = facts.map((fact) => `<div class="pmr-fact">${rows(fact.head.length ? fact.head.slice(0, 1) : [{ key: `fait:${fact.child.id}`, step: 'fait', status: 'neutre', subject: fact.child.label, text: 'Pas encore testé' }])}${fact.proofs.length ? `<div class="pmr-proofs">${rows(fact.proofs)}</div>` : ''}</div>`).join('');
      return `<section class="pmr-phase" data-status="${status}"><header><span class="pmr-step">Étape ${steps.indexOf(node) + 1}</span><button class="pmr-link" data-select="${escape(node.id)}"><strong>${escape(node.label)}</strong></button><span class="pmr-phase-state">${escape(head[0]?.text ?? '')}</span></header>${rule(node)}${issues.length ? issueList(unplaced(issues), false, true) : ''}${law ? `<h5>Droit</h5>${law}` : ''}${proved || pieces ? `<h5>Faits et pièces</h5>${pieces}${proved}` : ''}</section>`;
    };
    const alerts = entries.filter((entry) => entry.status === 'alerte').length;
    const run = `<div class="pmr-run"><button class="pmr-primary" data-run-test${running || busy || !context.project ? ' disabled' : ''}>${running ? played || unrolling ? 'Déroulé du test…' : 'Test en cours…' : snapshot?.test ? 'Relancer le test' : 'Lancer le test'}</button>${snapshot?.test && !live && !unrolling ? `<span class="pmr-muted">${escape(new Date(snapshot.test.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }))}</span>` : ''}${entries.length && !live && !unrolling ? `<span class="pmr-tally">${pill(alerts ? 'exclu' : 'acquis', alerts ? plural(alerts, 'alerte') : 'aucune alerte')}</span>` : ''}</div>`;
    const answer = rows(entries.filter((entry) => entry.step === 'réponse'));
    const stages = steps.map(stage).join('');
    const trials = rows(entries.filter((entry) => entry.step === 'essai'));
    const rest = rows(entries.filter((entry) => !used.has(entry.key)));
    const loose = visibleIssues().filter((issue) => !placed.has(issue.id) && !issue.path.startsWith('hypotheses'));
    const tested = visibleIssues().filter((issue) => issue.path.startsWith('hypotheses'));
    const dismissed = (snapshot?.issues ?? []).filter((issue) => dismissedIds().has(issue.id));
    detail.innerHTML = `${run}${entries.length ? '' : '<p class="pmr-muted">Le test relit chaque source et chaque pièce, puis exécute le raisonnement sur le dossier.</p>'}${loose.length ? `<section class="pmr-part"><h4>À corriger</h4>${issueList(loose)}</section>` : ''}${stages ? `<section class="pmr-part"><h4>Étapes du raisonnement</h4><p class="pmr-muted">Le raisonnement part des faits et monte, étape par étape, jusqu’à la réponse. Chaque étape est remplie quand ses conditions le sont : une condition est un fait prouvé par une pièce, ou une étape précédente.</p>${stages}</section>` : ''}${answer ? `<section class="pmr-part"><h4>Réponse</h4>${answer}</section>` : ''}${trials || tested.length ? `<section class="pmr-part"><h4>Hypothèses</h4>${issueList(tested, false, true)}${trials}</section>` : ''}${rest ? `<section class="pmr-part"><h4>Autres vérifications</h4>${rest}</section>` : ''}${dismissed.length ? `<details class="pmr-part"><summary class="pmr-muted">Ignorées par vous (${dismissed.length})</summary>${issueList(dismissed, true)}</details>` : ''}`;
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
    const launcher = root.querySelector<HTMLButtonElement>('.pmr-tools [data-run-test]')!;
    launcher.disabled = Boolean(running || busy || !context.project || !list.length);
    launcher.textContent = running ? played || unrolling ? 'Déroulé du test…' : 'Test en cours…' : snapshot?.test ? 'Relancer le test' : 'Lancer le test';
    const count = root.querySelector<HTMLElement>('[data-alerts]')!;
    const alerts = visibleIssues().length + log().filter((entry) => entry.status === 'alerte').length;
    count.hidden = !alerts;
    count.textContent = String(alerts);
    paintView();
    empty.hidden = Boolean(list.length);
    root.querySelector<HTMLElement>('.pmr-legend')!.hidden = !legend || !list.length;
    root.querySelector<HTMLElement>('[data-legend]')!.setAttribute('aria-pressed', String(legend));
    empty.innerHTML = !context.project ? '<strong>Aucun dossier</strong><p>Ouvrez un dossier pour voir son raisonnement.</p>' : snapshot?.code && !snapshot.annotated ? `<strong>Raisonnement illisible</strong><p>${escape(snapshot.issues.map((issue) => issue.text).join(' · '))}</p>` : '<strong>Pas encore de raisonnement</strong><p>Confiez un objectif juridique à l’agent dans le chat : il transcrit son raisonnement dans .piecemaker/raisonnements/, un fichier par sujet, que ce volet vérifie et affiche.</p>';
    buildGraph();
    paintGraph();
    paintTest();
  };

  const showError = (error: unknown) => { warning.hidden = false; warning.textContent = error instanceof Error ? error.message : String(error); };
  const apply = (data: ReasoningSnapshot) => {
    const next = JSON.stringify(data);
    warning.hidden = true;
    if (next === serialized) return;
    serialized = next;
    snapshot = data;
    if (scope >= objectives().length) scope = 0;
    paint();
  };
  const load = async () => {
    const request = ++sequence;
    try {
      const data = await loadReasoning(context.project?.path ?? null, false, reasoning);
      if (!stopped && request === sequence) apply(data);
    } catch (error) { if (!stopped && request === sequence) showError(error); }
  };
  const act = (run: () => Promise<ReasoningSnapshot>) => {
    busy = true;
    paint();
    run().then(apply, showError).finally(() => { busy = false; paint(); });
  };
  const follow = (cell: Cell) => {
    const spine = cells.find((item) => item.id === selectedCell) ?? cell;
    const aside = stage.querySelector<HTMLElement>('.pmr-note');
    const right = aside ? aside.offsetLeft + aside.offsetWidth : cell.x + cell.w / 2;
    const bottom = Math.max(cell.y + cell.h, spine.y + spine.h, aside ? aside.offsetTop + aside.offsetHeight : 0);
    const fit = (low: number, high: number, size: number) => (size - (high - low) * zoom) / 2 - low * zoom;
    const width = canvas.clientWidth - 40, height = canvas.clientHeight - 100;
    const left = [spine.x - spine.w / 2, cell.x - cell.w / 2].find((edge) => (right - edge) * zoom <= width);
    const top = Math.min(spine.y, cell.y);
    pan = { x: left === undefined ? canvas.clientWidth - 20 - right * zoom : fit(left, right, canvas.clientWidth), y: (bottom - top) * zoom <= height ? fit(top, bottom, canvas.clientHeight - 44) : 40 - top * zoom };
    transform();
  };
  const script = () => {
    const actions: Array<{ spine: Cell; cell: Cell; key: string }> = [];
    const seen = new Set<string>();
    const push = (spine: Cell, cell: Cell, key: string) => { if (!seen.has(key)) { seen.add(key); actions.push({ spine, cell, key }); } };
    for (const spine of cells.filter((cell) => !cell.parent)) {
      push(spine, spine, spine.id);
      const parts = sections(spine.id);
      for (const part of parts.filter((item) => item.cell !== spine.id)) {
        const cell = cells.find((item) => item.id === part.cell)!;
        push(spine, cell, cell.id);
        part.items.forEach((item) => push(spine, cell, item.key));
      }
      parts.filter((item) => item.cell === spine.id).forEach((part) => part.items.forEach((item) => push(spine, spine, item.key)));
    }
    return actions;
  };
  const replay = () => {
    played = new Set();
    live = [];
    paint();
    const actions = script();
    const tick = () => {
      const action = actions.shift();
      if (!action || stopped) { pacing = 0; played = null; live = null; fresh = null; running = false; busy = false; paint(); return; }
      played!.add(action.key);
      live = full().filter((entry) => played!.has(entry.key));
      fresh = { key: action.key, added: true };
      selected = action.spine.ref;
      selectedCell = action.spine.id;
      described = action.cell.id;
      paintTest();
      paintGraph();
      follow(action.cell);
      pacing = window.setTimeout(tick, 1000);
    };
    tick();
  };
  const unroll = () => {
    unrolling = true;
    paintTest();
    const units = '.pmr-part > h4, .pmr-part > p, .pmr-part > summary, .pmr-phase > header, .pmr-phase-rule, .pmr-phase > h5, .pmr-issue, .pmr-entry';
    const queue = [...detail.querySelectorAll<HTMLElement>(units)];
    detail.querySelectorAll<HTMLElement>(`${units}, .pmr-part, .pmr-phase, .pmr-log, .pmr-fact, .pmr-proofs`).forEach((element) => element.classList.add('is-pending'));
    const tick = () => {
      const unit = queue.shift();
      if (!unit || stopped) { pacing = 0; unrolling = false; running = false; busy = false; paint(); return; }
      detail.querySelectorAll('.is-new').forEach((element) => element.classList.remove('is-new'));
      for (let element: HTMLElement | null = unit; element && element !== detail; element = element.parentElement) element.classList.remove('is-pending');
      unit.classList.add('is-new');
      unit.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      pacing = window.setTimeout(tick, 1000);
    };
    tick();
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
  const select = (id: string, cell: string) => {
    if (selectedCell === cell) { selected = ''; selectedCell = ''; } else { selected = id; selectedCell = cell; }
    described = selectedCell;
    highlight();
    const chosen = cells.find((item) => item.id === selectedCell);
    if (chosen) follow(chosen);
  };
  const reach = (id: string) => {
    selected = id;
    selectedCell = cells.find((cell) => cell.ref === id)?.id ?? id;
    described = selectedCell;
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
    if (button.hasAttribute('data-legend')) { legend = !legend; paint(); }
    if (button.hasAttribute('data-run-test') && project && !running) {
      running = true;
      busy = true;
      selected = '';
      selectedCell = '';
      paint();
      const unfold = view === 'graph' ? replay : unroll;
      if (snapshot?.demo) { unfold(); return; }
      runTest(project, () => {}, shown()).then((data) => { apply(data); unfold(); }, (error) => { running = false; busy = false; showError(error); paint(); });
    }
    if (button.dataset.select) reach(button.dataset.select);
    if (button.dataset.show) show(button.dataset.show, button.dataset.quote);
    if (button.dataset.dismiss && project) act(() => button.dataset.dismiss!.split(' ').reduce((done, id) => done.then(() => dismissIssue(project, id, button.hasAttribute('data-restore'), shown())), Promise.resolve(snapshot!)));
    if (button.dataset.rate && project) act(() => ratePiece(project, button.dataset.rate!, button.dataset.value === 'null' ? null : button.dataset.value === 'true', shown()));
    if (button.dataset.zoom) {
      const next = Math.max(.2, Math.min(2.5, zoom * (Number(button.dataset.zoom) > 0 ? 1.2 : 1 / 1.2)));
      pan = { x: canvas.clientWidth / 2 - (canvas.clientWidth / 2 - pan.x) * next / zoom, y: canvas.clientHeight / 2 - (canvas.clientHeight / 2 - pan.y) * next / zoom };
      zoom = next;
      transform();
    }
    if (button.hasAttribute('data-center')) { fitGraph(); transform(); }
  });
  picker.addEventListener('change', () => { scope = Number(picker.value); selected = ''; selectedCell = ''; paint(); });
  chooser.addEventListener('change', () => { reasoning = chooser.value; serialized = ''; scope = 0; selected = ''; selectedCell = ''; void load(); });

  root.addEventListener('pointerdown', (event) => {
    const target = event.target as Element;
    if (!selected || target.closest('.pmr-note, [data-node]') || (canvas.contains(target) && !target.closest('button'))) return;
    selected = '';
    selectedCell = '';
    highlight();
  });
  canvas.addEventListener('pointerdown', (event) => {
    if ((event.target as Element).closest('button, .pmr-note') || event.button !== 0) return;
    const element = (event.target as Element).closest<HTMLElement>('[data-node]');
    drag = { id: element?.dataset.node ?? '', cell: element?.dataset.id ?? '', x: event.clientX, y: event.clientY, moved: false };
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
    if (drag && !drag.moved) { if (drag.id) select(drag.id, drag.cell); else if (selected) { selected = ''; selectedCell = ''; highlight(); } }
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  stage.addEventListener('keydown', (event) => {
    const element = (event.target as Element).closest<HTMLElement>('[data-node]');
    if (element && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); select(element.dataset.node!, element.dataset.id!); }
  });
  canvas.addEventListener('wheel', (event) => {
    if ((event.target as Element).closest('.pmr-note')) return;
    event.preventDefault();
    if (!event.ctrlKey && !event.metaKey) { pan = { x: pan.x - event.deltaX, y: pan.y - event.deltaY }; transform(); return; }
    const box = canvas.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top;
    const next = Math.max(.2, Math.min(2.5, zoom * Math.exp(-event.deltaY / 200)));
    pan = { x: x - (x - pan.x) * next / zoom, y: y - (y - pan.y) * next / zoom };
    zoom = next;
    transform();
  }, { passive: false });

  const resize = new ResizeObserver(() => layoutGraph(!focusing));
  resize.observe(canvas);
  const unsubscribe = api.onContextChange((next) => {
    const changed = next.project?.path !== context.project?.path;
    context = next;
    if (changed) { sequence++; snapshot = null; reasoning = undefined; serialized = ''; scope = 0; selected = ''; selectedCell = ''; shape = ''; void load(); }
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
