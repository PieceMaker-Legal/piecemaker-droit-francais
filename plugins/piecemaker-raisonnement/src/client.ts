import { REASONING_FORCES } from '../../../shared/piecemaker-reasoning.js';
import type { ReasoningCondition, ReasoningFact, ReasoningQuestion, ReasoningReview, ReasoningSnapshot, ReasoningSource, ReasoningTestRun, ReasoningValue } from '../../../shared/piecemaker-reasoning.js';
import { appreciateFact, deleteTest, loadReasoning, reviewItem, runTest, saveTest } from './api.js';
import { STYLES } from './styles.js';

type Context = { theme: 'dark' | 'light'; project: { name: string; path: string } | null };
type Host = { readonly context: Context; onContextChange(callback: (context: Context) => void): () => void; openFileInEditor?(file: string): void };
type Tab = 'detail' | 'tests' | 'code';
type Kind = 'source' | 'condition' | 'result' | 'fact';
type GraphNode = { id: string; label: string; kind: Kind; value: string; uncertain: boolean; missing: boolean; x: number; y: number };
type Edge = { from: string; to: string };

const COLORS: Record<Kind, string> = { source: '#6b9fdb', condition: '#ba9ce9', result: '#e2a5c6', fact: '#68bea3' };
const COLUMN: Record<Kind, number> = { source: -230, condition: 0, result: 0, fact: 230 };
const FORCE_LABELS: Record<string, string> = { acte_authentique: 'Acte authentique', 'acte_sous_seing_privé': 'Acte sous seing privé', commencement_de_preuve: 'Commencement de preuve', indice: 'Indice', sans_valeur: 'Sans valeur probante' };
const ANSWER: Record<ReasoningQuestion['status'], string> = { remplie: 'Oui', 'non remplie': 'Non', indéterminée: 'Pas encore établi', bloquée: 'Fondement à revoir' };
const CONDITION: Record<ReasoningCondition['status'], string> = { remplie: 'Remplie', 'non remplie': 'Non remplie', indéterminée: 'À établir', bloquée: 'Fondement à revoir' };
const OBJECTIVE = { atteint: 'atteint', 'à établir': 'reste à établir', 'hors d’atteinte': 'hors d’atteinte' };
const TONE: Record<string, string> = { remplie: 'ok', établi: 'ok', 'non remplie': 'ko', bloquée: 'ko', indéterminée: 'warn', 'non établi': 'warn' };
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const human = (variable: string) => { const text = variable.replace(/_/g, ' '); return text.charAt(0).toUpperCase() + text.slice(1); };
const shorten = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);
const pill = (status: string, label: string) => `<span class="pmr-pill pmr-${TONE[status] ?? 'muted'}">${escape(label)}</span>`;
const cleanups = new WeakMap<HTMLElement, () => void>();

function formatValue(value: ReasoningValue): string {
  if (value === null) return 'inconnu';
  if (typeof value === 'boolean') return value ? 'oui' : 'non';
  if (typeof value === 'number') return String(value).replace('.', ',');
  if (typeof value === 'string') return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : value;
  return [value.ans && `${value.ans} an(s)`, value.mois && `${value.mois} mois`, value.jours && `${value.jours} jour(s)`].filter(Boolean).join(' ') || '0 jour';
}

function rawValue(value: ReasoningValue): string {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'vrai' : 'faux';
  if (typeof value === 'object') return value.ans ? `${value.ans} an` : value.mois ? `${value.mois} mois` : `${value.jours} jour`;
  return String(value);
}

function parseInput(type: string, raw: string): ReasoningValue {
  if (type === 'booléen') return raw === 'vrai';
  if (type === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error('Date attendue.'); return raw; }
  if (type === 'durée') {
    const match = /^(\d+)\s*(an|ans|mois|jour|jours)$/.exec(raw.trim());
    if (!match) throw new Error('Durée attendue, par exemple « 5 an » ou « 2 mois ».');
    const unit = match[2].startsWith('an') ? 'ans' : match[2] === 'mois' ? 'mois' : 'jours';
    return { ans: 0, mois: 0, jours: 0, [unit]: Number(match[1]) };
  }
  const number = Number(raw.replace(',', '.'));
  if (!raw.trim() || !Number.isFinite(number)) throw new Error('Nombre attendu.');
  return number;
}

export function mount(container: HTMLElement, api: Host) {
  const style = document.createElement('style');
  style.textContent = STYLES;
  const root = document.createElement('section');
  root.className = 'pmr';
  root.setAttribute('aria-label', 'Raisonnement du dossier');
  root.innerHTML = `<header class="pmr-head"><strong>Raisonnement</strong><select data-scope aria-label="Question" hidden></select><button data-demo>Exemple fictif</button><button data-refresh aria-label="Actualiser">↻</button></header><div class="pmr-meta"></div><div class="pmr-warning" hidden></div><div class="pmr-workspace"><div class="pmr-canvas" aria-label="Graphe du raisonnement"><svg role="group" aria-label="Sources, conditions et faits"></svg><div class="pmr-empty" hidden></div><div class="pmr-legend"><span><i style="background:${COLORS.source}"></i>Loi, jurisprudence, doctrine</span><span><i style="background:${COLORS.condition}"></i>Conditions</span><span><i style="background:${COLORS.fact}"></i>Faits prouvés par pièces</span></div><div class="pmr-tools"><button data-zoom="-1" aria-label="Dézoomer">−</button><button data-zoom="1" aria-label="Zoomer">+</button><button data-center>Centrer</button></div></div><div class="pmr-inspector"><div class="pmr-tabs" role="tablist"><button role="tab" data-tab="detail">Détail</button><button role="tab" data-tab="tests">Tests</button><button role="tab" data-tab="code">Code</button></div><div class="pmr-detail"></div></div></div>`;
  container.replaceChildren(style, root);
  const canvas = root.querySelector<HTMLElement>('.pmr-canvas')!;
  const svg = root.querySelector<SVGSVGElement>('svg')!;
  const detail = root.querySelector<HTMLElement>('.pmr-detail')!;
  const warning = root.querySelector<HTMLElement>('.pmr-warning')!;
  const empty = root.querySelector<HTMLElement>('.pmr-empty')!;
  const picker = root.querySelector<HTMLSelectElement>('[data-scope]')!;
  let context = api.context;
  let snapshot: ReasoningSnapshot | null = null;
  let lastSerialized = '';
  let tab: Tab = 'detail';
  let scope = '';
  let selected = '';
  let editing = '';
  let nodes: GraphNode[] = [];
  let edges: Edge[] = [];
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  let drag: { id: string; x: number; y: number; moved: boolean } | null = null;
  let testValues: Record<string, string> = {};
  let lastRun: (ReasoningTestRun & { values: Record<string, ReasoningValue> }) | null = null;
  let sequence = 0;
  let stopped = false;
  let timer = 0;

  const question = () => snapshot?.questions.find((entry) => entry.scope === scope) ?? snapshot?.questions[0];
  const source = (id: string) => snapshot?.sources.find((entry) => entry.id === id);
  const condition = (id: string) => snapshot?.conditions.find((entry) => entry.id === id);
  const fact = (id: string) => snapshot?.facts.find((entry) => entry.id === id);
  const pieces = () => new Set(snapshot?.facts.flatMap((entry) => entry.sources) ?? []);
  const sourceKind = (entry: ReasoningSource) => (entry.kind === 'article' ? 'Loi' : entry.kind === 'case' ? 'Jurisprudence' : pieces().has(entry.id) ? 'Pièce' : 'Doctrine');
  const sourceProblem = (entry: ReasoningSource | undefined) => (!entry ? 'Source inconnue' : !entry.verified ? 'Extrait introuvable dans la source' : entry.history?.status === 'remise en cause' ? 'Remise en cause par une décision postérieure' : entry.history?.status === 'à examiner' ? 'Historique judiciaire à examiner' : '');
  const nameOf = (id: string) => (id === `${question()?.scope}.${question()?.result}` ? 'Réponse' : undefined) ?? condition(id)?.label ?? (fact(id) ? human(fact(id)!.variable) : source(id.replace(/^source:/, ''))?.title ?? id);
  const link = (id: string) => `<button class="pmr-link" data-select="${escape(id)}">${escape(nameOf(id))}</button>`;

  const branch = (key: string) => {
    const found = new Set([key]);
    const walk = (current: string, up: boolean) => { for (const edge of edges) { const [from, to] = up ? [edge.to, edge.from] : [edge.from, edge.to]; if (from === current && !found.has(to)) { found.add(to); walk(to, up); } } };
    walk(key, true);
    walk(key, false);
    return found;
  };

  const radius = (node: GraphNode) => (node.kind === 'result' ? 19 : node.kind === 'source' ? 10 : 14);
  const size = () => ({ width: Math.max(320, canvas.clientWidth), height: Math.max(240, canvas.clientHeight) });
  const paintGraph = () => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const members = selected ? branch(selected) : null;
    const { width, height } = size();
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.innerHTML = `<defs><marker id="pmr-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill="currentColor"/></marker></defs><g transform="translate(${width / 2 + pan.x} ${height / 2 + pan.y}) scale(${zoom})">${edges.map((edge) => {
      const a = byId.get(edge.from), b = byId.get(edge.to);
      if (!a || !b) return '';
      const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const gap = b.kind === 'result' ? 22 : b.kind === 'source' ? 13 : 18;
      const lit = members?.has(edge.from) && members.has(edge.to);
      const x2 = b.x - (b.x - a.x) / distance * gap, y2 = b.y - (b.y - a.y) / distance * gap;
      const curve = a.x === b.x ? ` Q${a.x - Math.abs(b.y - a.y) * 0.45} ${(a.y + b.y) / 2} ` : ' L';
      return `<path marker-end="url(#pmr-arrow)" class="pmr-edge${lit ? ' is-neighbour' : ''}${members && !lit ? ' is-dim' : ''}" d="M${a.x} ${a.y}${curve}${a.x === b.x ? `${b.x - gap * 0.7} ${b.y + Math.sign(a.y - b.y) * gap * 0.7}` : `${x2} ${y2}`}"/>`;
    }).join('')}${nodes.map((node) => `<g class="pmr-node${selected === node.id ? ' is-selected' : ''}${members && !members.has(node.id) ? ' is-dim' : ''}${node.uncertain ? ' is-uncertain' : ''}${node.missing ? ' is-missing' : ''}" data-node="${escape(node.id)}" transform="translate(${node.x} ${node.y})" tabindex="0" role="button" aria-label="${escape(`${node.label}, ${node.value}`)}"><circle r="${radius(node)}" fill="${COLORS[node.kind]}"/><text text-anchor="middle" y="${radius(node) + 15}"${node.kind === 'result' ? ' class="pmr-strong"' : ''}>${escape(shorten(node.label, 30))}</text><text text-anchor="middle" class="pmr-value" y="${radius(node) + 29}">${escape(node.value)}</text><title>${escape(`${node.label}\n${node.value}`)}</title></g>`).join('')}</g>`;
  };

  const fitGraph = () => {
    if (!nodes.length) { zoom = 1; pan = { x: 0, y: 0 }; return; }
    const minX = Math.min(...nodes.map((node) => node.x)) - 105, maxX = Math.max(...nodes.map((node) => node.x)) + 105;
    const minY = Math.min(...nodes.map((node) => node.y)) - 20, maxY = Math.max(...nodes.map((node) => node.y)) + 50;
    const { width, height } = size();
    zoom = Math.min(1.2, (width - 24) / Math.max(1, maxX - minX), (height - 70) / Math.max(1, maxY - minY));
    pan = { x: -(minX + maxX) / 2 * zoom, y: -(minY + maxY) / 2 * zoom - 22 };
  };

  const buildGraph = () => {
    const current = question();
    const old = new Map(nodes.map((node) => [node.id, node]));
    nodes = [];
    edges = [];
    if (!snapshot || !current) { paintGraph(); return; }
    const resultId = `${current.scope}.${current.result}`;
    const add = (id: string, label: string, kind: Kind, value: string, uncertain = false, missing = false) => {
      if (nodes.some((node) => node.id === id)) return;
      const previous = old.get(id);
      nodes.push({ id, label, kind, value, uncertain, missing, x: previous?.x ?? 0, y: previous?.y ?? 0 });
    };
    const conditions = current.conditions.map(condition).filter((entry): entry is ReasoningCondition => Boolean(entry));
    for (const entry of conditions) add(entry.id, entry.id === resultId ? current.question || entry.label : entry.label, entry.id === resultId ? 'result' : 'condition', entry.id === resultId ? `Réponse : ${ANSWER[current.status]}` : CONDITION[entry.status], entry.status !== 'remplie' && entry.status !== 'non remplie' || (entry.issues.length > 0 && !entry.review));
    for (const entry of conditions) for (const id of entry.sources) {
      const found = source(id);
      add(`source:${id}`, found?.title ?? id, 'source', found ? sourceKind(found) : 'Source inconnue', Boolean(sourceProblem(found)));
      edges.push({ from: `source:${id}`, to: entry.id });
    }
    for (const entry of snapshot.facts.filter((item) => item.scope === current.scope)) add(entry.id, human(entry.variable), 'fact', entry.status === 'établi' ? `Prouvé : ${formatValue(entry.value)}` : 'À prouver', entry.status !== 'établi', !entry.sources.length);
    for (const entry of conditions) for (const dependency of entry.dependsOn) if (nodes.some((node) => node.id === dependency)) edges.push({ from: dependency, to: entry.id });
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const fresh = nodes.filter((node) => !old.has(node.id));
    const conditionsColumn = fresh.filter((node) => node.kind === 'condition');
    conditionsColumn.forEach((node, index) => { node.x = COLUMN.condition; node.y = (index - (conditionsColumn.length - 1) / 2) * 84; });
    fresh.filter((node) => node.kind === 'result').forEach((node) => { node.x = COLUMN.result; node.y = -(conditionsColumn.length + 1) / 2 * 84 - 40; });
    for (const kind of ['source', 'fact'] as const) {
      const column = fresh.filter((node) => node.kind === kind);
      const target = (node: GraphNode) => {
        const ys = edges.filter((edge) => edge.from === node.id).map((edge) => byId.get(edge.to)!.y);
        return ys.length ? ys.reduce((sum, y) => sum + y, 0) / ys.length : 1e9;
      };
      column.sort((a, b) => target(a) - target(b)).forEach((node, index) => { node.x = COLUMN[kind]; node.y = (index - (column.length - 1) / 2) * 84; });
    }
    if (selected && !byId.has(selected)) selected = '';
    if (nodes.some((node) => !old.has(node.id))) fitGraph();
    paintGraph();
  };

  const sourceBlock = (id: string) => {
    const entry = source(id);
    if (!entry) return `<p class="pmr-warn">Source inconnue (${escape(id)}).</p>`;
    const problem = sourceProblem(entry);
    return `<div class="pmr-quote"><p><strong>${escape(sourceKind(entry))}</strong> · ${escape(entry.title)} <button class="pmr-link" data-open="${escape(entry.id)}">Ouvrir</button></p><blockquote>${escape(entry.excerpt)}</blockquote>${problem ? `<p class="pmr-warn">${escape(problem)}</p>` : ''}</div>`;
  };
  const problems = (list: string[]) => (list.length ? `<div class="pmr-problems"><strong>À revoir</strong><ul>${list.map((issue) => `<li>${escape(issue)}</li>`).join('')}</ul></div>` : '');
  const decision = (id: string, review: ReasoningReview | undefined, editable = false) => {
    if (snapshot?.demo) return '';
    const edit = editable ? `<button data-edit="${escape(id)}">Modifier la valeur de la pièce</button>` : '';
    if (review) return `<div class="pmr-decision"><span>${pill(review.status === 'validé' ? 'remplie' : 'bloquée', review.status === 'validé' ? 'Validé par vous' : 'Écarté par vous')}${review.note ? ` ${escape(review.note)}` : ''}</span>${edit}<button data-review="${escape(id)}" data-status="">Annuler</button></div>`;
    return `<div class="pmr-decision"><button class="pmr-primary" data-review="${escape(id)}" data-status="validé">Valider</button><button data-review="${escape(id)}" data-status="écarté">Écarter</button>${edit}</div>`;
  };
  const linked = (id: string) => {
    const ids = [...new Set(edges.flatMap((edge) => (edge.from === id ? [edge.to] : edge.to === id ? [edge.from] : [])))].filter((other) => !other.startsWith('source:'));
    return ids.length ? `<p class="pmr-muted">Lié à : ${ids.map(link).join(' ')}</p>` : '';
  };

  const factForm = (entry: ReasoningFact) => {
    const value = entry.type === 'booléen'
      ? `<select name="value"><option value="vrai"${entry.value === true ? ' selected' : ''}>Oui</option><option value="faux"${entry.value === false ? ' selected' : ''}>Non</option></select>`
      : `<input name="value" ${entry.type === 'date' ? 'type="date"' : ''} value="${escape(entry.value === null || entry.type === 'durée' ? '' : entry.value)}" placeholder="${entry.type === 'durée' ? '5 an, 2 mois, 10 jour' : ''}" aria-label="Valeur">`;
    return `<form class="pmr-form" data-fact="${escape(entry.id)}"><label>Valeur ${value}</label><label>Force probante <select name="force"><option value="">—</option>${REASONING_FORCES.map((force) => `<option value="${force}"${entry.force === force ? ' selected' : ''}>${FORCE_LABELS[force]}</option>`).join('')}</select></label><label>Appréciation <textarea name="appreciation">${escape(entry.appreciation)}</textarea></label><div class="pmr-decision"><button class="pmr-primary" type="submit">Enregistrer et valider</button><button type="button" data-cancel>Annuler</button></div></form>`;
  };

  const summary = (current: ReasoningQuestion) => {
    const principal = current.voies.find((voie) => voie.favorable);
    const toProve = principal?.toProve ?? current.facts.filter((id) => fact(id)?.status !== 'établi');
    const weak = current.conditions.filter((id) => (condition(id)?.issues.length ?? 0) > 0 && !condition(id)?.review);
    const pending = [...snapshot!.conditions, ...snapshot!.facts].filter((item) => item.scope === current.scope && !item.review).length;
    const objective = current.objective === null || !current.objectiveStatus ? '' : `<p>Objectif du client : obtenir « ${current.objective ? 'oui' : 'non'} » — <strong>${OBJECTIVE[current.objectiveStatus]}</strong>.</p>`;
    return `<h3>${escape(current.question || current.scope)}</h3>
      <p class="pmr-answer">Réponse : ${pill(current.status, ANSWER[current.status])}</p>${objective}
      ${toProve.length ? `<p>Reste à prouver : ${toProve.map(link).join(' ')}</p>` : ''}
      ${weak.length ? `<p>Conditions à revoir : ${weak.map(link).join(' ')}</p>` : ''}
      ${current.issues.length ? problems(current.issues) : ''}
      ${pending && !snapshot!.demo ? `<p class="pmr-muted">${pending} point(s) attendent votre validation.</p>` : ''}
      <p class="pmr-muted">Cliquez sur un point du graphe pour voir son fondement et le valider.</p>`;
  };

  const nodeDetail = (current: ReasoningQuestion, id: string) => {
    const back = '<button class="pmr-link" data-unselect>← Vue d’ensemble</button>';
    const law = condition(id);
    if (law) {
      const isResult = law.id === `${current.scope}.${current.result}`;
      return `${back}<h3>${escape(isResult ? current.question || law.label : law.label)}</h3>
        <p class="pmr-answer">${isResult ? `Réponse : ${pill(current.status, ANSWER[current.status])}` : pill(law.status, CONDITION[law.status])}${law.strength ? ` <span class="pmr-muted">fondée sur la ${law.strength === 'loi' ? 'loi' : law.strength}</span>` : ''}</p>
        ${law.sources.map(sourceBlock).join('') || '<p class="pmr-warn">Aucun fondement cité.</p>'}${problems(law.issues)}${linked(id)}${decision(id, law.review)}`;
    }
    const item = fact(id);
    if (item) {
      return `${back}<h3>${escape(human(item.variable))}</h3>
        <p class="pmr-answer">${pill(item.status, item.status === 'établi' ? 'Prouvé' : 'À prouver')} <span class="pmr-muted">valeur : ${escape(formatValue(item.value))}</span></p>
        ${item.sources.map(sourceBlock).join('') || '<p class="pmr-warn">Aucune pièce : à rechercher dans le dossier.</p>'}
        <p>Valeur de la pièce : ${item.force ? `<strong>${escape(FORCE_LABELS[item.force])}</strong>` : 'non appréciée'}${item.appreciation ? ` — ${escape(item.appreciation)}` : ''} <span class="pmr-muted">(${item.author === 'avocat' ? 'votre appréciation' : 'appréciation de l’IA'})</span></p>
        ${item.burden ? `<p class="pmr-muted">Preuve à la charge ${item.burden === 'nous' ? 'du client' : 'de l’adversaire'}.</p>` : ''}
        ${problems(item.issues)}${linked(id)}${editing === id ? factForm(item) : decision(id, item.review, true)}`;
    }
    const entry = source(id.replace(/^source:/, ''));
    if (!entry) return back;
    const users = [...snapshot!.conditions.filter((other) => other.sources.includes(entry.id)), ...snapshot!.facts.filter((other) => other.sources.includes(entry.id))].map((other) => other.id);
    const period = entry.validity ? `<p class="pmr-muted">Version en vigueur du ${formatValue(entry.validity.from)} ${entry.validity.to ? `au ${formatValue(entry.validity.to)}` : 'à ce jour'}.</p>` : '';
    return `${back}<h3>${escape(entry.title)}</h3>${sourceBlock(entry.id)}${period}${entry.history ? `<p class="pmr-muted">Historique judiciaire : ${escape(entry.history.status)}.</p>` : ''}${users.length ? `<p class="pmr-muted">Utilisée pour : ${users.map(link).join(' ')}</p>` : ''}`;
  };

  const testsView = (current: ReasoningQuestion) => {
    if (snapshot!.demo) return '<p class="pmr-muted">Les tests s’exécutent sur le raisonnement d’un dossier, pas sur l’exemple fictif.</p>';
    const facts = snapshot!.facts.filter((entry) => entry.scope === current.scope);
    const inputs = facts.map((entry) => {
      const raw = testValues[entry.id] ?? (entry.status === 'établi' ? rawValue(entry.value) : '');
      const field = entry.type === 'booléen'
        ? `<select data-test-input="${escape(entry.id)}"><option value="">Inconnu</option><option value="vrai"${raw === 'vrai' ? ' selected' : ''}>Oui</option><option value="faux"${raw === 'faux' ? ' selected' : ''}>Non</option></select>`
        : `<input data-test-input="${escape(entry.id)}" ${entry.type === 'date' ? 'type="date"' : ''} value="${escape(raw)}" placeholder="${entry.type === 'durée' ? '5 an, 2 mois' : 'inconnu'}">`;
      return `<label class="pmr-test-row"><span>${escape(human(entry.variable))}</span>${field}</label>`;
    }).join('');
    const run = lastRun && lastRun.question.scope === current.scope ? `<div class="pmr-box"><p class="pmr-answer">Résultat : ${pill(lastRun.question.status, ANSWER[lastRun.question.status])}</p><div class="pmr-decision"><input data-test-label placeholder="Nom du test" aria-label="Nom du test"><button data-save-test>Enregistrer</button></div></div>` : '';
    const saved = snapshot!.tests.filter((entry) => entry.scope === current.scope).map((entry) => `<div class="pmr-box"><p class="pmr-answer">${pill(entry.passed ? 'remplie' : 'bloquée', entry.passed ? 'Réussi' : 'Échec')} ${escape(entry.label)} <button class="pmr-link" data-delete-test="${escape(entry.id)}">Supprimer</button></p><p class="pmr-muted">Attendu : ${escape(ANSWER[entry.expected])} · obtenu : ${escape(entry.actual ? ANSWER[entry.actual] : 'erreur')}</p></div>`).join('');
    return `<p class="pmr-muted">Changez les faits pour voir si la réponse change. Un test enregistré est rejoué à chaque nouvelle version du raisonnement.</p><div class="pmr-test">${inputs || '<p class="pmr-muted">Aucun fait à faire varier.</p>'}</div><div class="pmr-decision"><button class="pmr-primary" data-run-test>Exécuter</button><button data-reset-test>Revenir aux faits du dossier</button></div>${run}${saved ? `<h4>Tests enregistrés</h4>${saved}` : ''}`;
  };

  const paintDetails = () => {
    root.querySelectorAll<HTMLElement>('[data-tab]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.tab === tab)));
    const current = question();
    if (!snapshot?.code || !current) { detail.innerHTML = ''; return; }
    if (tab === 'code') detail.innerHTML = `<pre>${escape(snapshot.code)}</pre>`;
    else if (tab === 'tests') detail.innerHTML = testsView(current);
    else detail.innerHTML = selected ? nodeDetail(current, selected) : summary(current);
  };

  const paint = () => {
    root.dataset.theme = context.theme;
    root.querySelector<HTMLElement>('[data-demo]')!.textContent = snapshot?.demo ? 'Revenir au dossier' : 'Exemple fictif';
    const meta = root.querySelector<HTMLElement>('.pmr-meta')!;
    meta.textContent = !snapshot ? (context.project ? 'Chargement…' : 'Aucun dossier ouvert.') : snapshot.demo ? 'Exemple fictif, non enregistré dans le dossier.' : snapshot.revision ? `Version ${snapshot.revision} du raisonnement` : '';
    warning.hidden = !snapshot?.diagnostics.length;
    warning.textContent = snapshot?.diagnostics.join(' · ') ?? '';
    const questions = snapshot?.questions ?? [];
    picker.hidden = questions.length < 2;
    picker.innerHTML = questions.map((entry) => `<option value="${escape(entry.scope)}"${entry.scope === question()?.scope ? ' selected' : ''}>${escape(entry.question || entry.scope)}</option>`).join('');
    empty.hidden = Boolean(snapshot?.code);
    empty.innerHTML = '<strong>Aucun raisonnement</strong><p>Posez une question de droit dans le chat : les conditions, leurs fondements et les pièces apparaissent ici à la fin du tour.</p><button data-demo>Voir l’exemple fictif</button>';
    buildGraph();
    paintDetails();
  };

  const showError = (error: unknown) => { warning.hidden = false; warning.textContent = error instanceof Error ? error.message : 'Action impossible.'; };
  const apply = (data: ReasoningSnapshot) => { lastSerialized = JSON.stringify(data); snapshot = data; editing = ''; paint(); };
  const load = async (example = false) => {
    const request = ++sequence;
    try {
      if (!example && !context.project) { paint(); return; }
      const data = await loadReasoning(context.project?.path ?? null, example);
      if (stopped || request !== sequence) return;
      const serialized = JSON.stringify(data);
      if (serialized === lastSerialized) return;
      lastSerialized = serialized;
      snapshot = data;
      if (!editing && !detail.contains(document.activeElement)) paint();
    } catch (error) {
      if (!stopped && request === sequence) showError(error);
    }
  };
  const select = (id: string) => { selected = selected === id ? '' : id; tab = 'detail'; editing = ''; paintGraph(); paintDetails(); };

  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('button');
    if (!button) return;
    if (button.dataset.tab) { tab = button.dataset.tab as Tab; paintDetails(); }
    if (button.hasAttribute('data-demo')) { lastSerialized = ''; editing = ''; selected = ''; scope = ''; lastRun = null; nodes = []; void load(!snapshot?.demo); }
    if (button.hasAttribute('data-refresh')) { lastSerialized = ''; void load(Boolean(snapshot?.demo)); }
    if (button.dataset.select) select(button.dataset.select);
    if (button.hasAttribute('data-unselect')) select(selected);
    if (button.dataset.open) {
      const entry = source(button.dataset.open);
      if (entry?.token) api.openFileInEditor?.(`piecemaker://citation/${entry.token}/${encodeURIComponent(entry.title)}`);
    }
    if (button.dataset.edit) { editing = button.dataset.edit; paintDetails(); }
    if (button.hasAttribute('data-cancel')) { editing = ''; paintDetails(); }
    if (button.dataset.zoom) { zoom = Math.max(.1, Math.min(3, zoom * (Number(button.dataset.zoom) > 0 ? 1.2 : 1 / 1.2))); paintGraph(); }
    if (button.hasAttribute('data-center')) { fitGraph(); paintGraph(); }
    if (button.dataset.review && context.project && !snapshot?.demo) {
      const status = (button.dataset.status || null) as 'validé' | 'écarté' | null;
      const note = status === 'écarté' ? window.prompt('Motif (facultatif)') ?? undefined : undefined;
      void reviewItem(context.project.path, button.dataset.review, status, note).then(apply).catch(showError);
    }
    if (button.hasAttribute('data-reset-test')) { testValues = {}; lastRun = null; paintDetails(); }
    if (button.hasAttribute('data-run-test') && context.project) {
      const current = question();
      if (!current) return;
      try {
        const values = Object.fromEntries(snapshot!.facts.filter((entry) => entry.scope === current.scope).map((entry) => {
          const raw = testValues[entry.id] ?? (entry.status === 'établi' ? rawValue(entry.value) : '');
          return [entry.id, raw === '' ? null : parseInput(entry.type, raw)];
        }));
        void runTest(context.project.path, current.scope, values).then((result) => { lastRun = { ...result, values }; paintDetails(); }).catch(showError);
      } catch (error) { showError(error); }
    }
    if (button.hasAttribute('data-save-test') && context.project && lastRun) {
      const label = root.querySelector<HTMLInputElement>('[data-test-label]')?.value.trim() ?? '';
      if (!label) { showError(new Error('Donnez un nom au test.')); return; }
      void saveTest(context.project.path, { label, scope: lastRun.question.scope, values: lastRun.values, expected: lastRun.question.status }).then((data) => { lastRun = null; apply(data); }).catch(showError);
    }
    if (button.dataset.deleteTest && context.project) void deleteTest(context.project.path, button.dataset.deleteTest).then(apply).catch(showError);
  });
  root.addEventListener('input', (event) => {
    const input = (event.target as Element).closest<HTMLInputElement | HTMLSelectElement>('[data-test-input]');
    if (input) testValues[input.dataset.testInput!] = input.value;
  });
  picker.addEventListener('change', () => { scope = picker.value; selected = ''; lastRun = null; nodes = []; paint(); });
  root.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = (event.target as Element).closest<HTMLFormElement>('form[data-fact]');
    const entry = fact(form?.dataset.fact ?? '');
    if (!form || !entry || !context.project) return;
    const data = new FormData(form);
    try {
      const value = parseInput(entry.type, String(data.get('value') ?? ''));
      void appreciateFact(context.project.path, entry.id, { value, force: String(data.get('force') || '') || null, appreciation: String(data.get('appreciation') ?? '') }).then(apply).catch(showError);
    } catch (error) { showError(error); }
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
    root.dataset.theme = next.theme;
    if (changed) { sequence++; snapshot = null; lastSerialized = ''; editing = ''; scope = ''; selected = ''; testValues = {}; lastRun = null; nodes = []; void load(); }
    paint();
  });
  const poll = () => { if (!stopped) { if (!snapshot?.demo) void load(); timer = window.setTimeout(poll, 2500); } };
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
