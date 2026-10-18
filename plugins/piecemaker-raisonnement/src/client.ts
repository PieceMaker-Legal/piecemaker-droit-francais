import { REASONING_FORCES } from '../../../shared/piecemaker-reasoning.js';
import type { ReasoningCondition, ReasoningFact, ReasoningQuestion, ReasoningReview, ReasoningSnapshot, ReasoningSource, ReasoningTestRun, ReasoningValue } from '../../../shared/piecemaker-reasoning.js';
import { appreciateFact, deleteTest, loadReasoning, reviewItem, runTest, saveTest } from './api.js';
import { STYLES } from './styles.js';

type Context = { theme: 'dark' | 'light'; project: { name: string; path: string } | null };
type Host = { readonly context: Context; onContextChange(callback: (context: Context) => void): () => void; openFileInEditor?(file: string): void };
type Tab = 'graph' | 'schema' | 'tests' | 'code' | 'sources';
type GraphNode = { key: string; column: number; label: string; sub: string; status: string; kind: 'source' | 'condition' | 'result' | 'fact'; x: number; y: number };
const NODE = { width: 164, height: 50, column: 188, row: 62 };

const FORCE_LABELS: Record<string, string> = { acte_authentique: 'Acte authentique', 'acte_sous_seing_privé': 'Acte sous seing privé', commencement_de_preuve: 'Commencement de preuve', indice: 'Indice', sans_valeur: 'Sans valeur probante' };
const STRENGTH_LABELS = { loi: 'Loi', jurisprudence: 'Jurisprudence', doctrine: 'Doctrine' };
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const slug = (value: string) => value.replace(/\s+/g, '-');
const badge = (status: string, label = status) => `<span class="pmr-badge pmr-s-${escape(slug(status))}">${escape(label)}</span>`;
const cleanups = new WeakMap<HTMLElement, () => void>();

function formatValue(value: ReasoningValue): string {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'Vrai' : 'Faux';
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

const shorten = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

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
  root.innerHTML = `<header class="pmr-head"><strong>Raisonnement</strong><div class="pmr-tabs" role="tablist"><button role="tab" data-tab="graph">Graphe</button><button role="tab" data-tab="schema">Schéma</button><button role="tab" data-tab="tests">Tests</button><button role="tab" data-tab="code">Code</button><button role="tab" data-tab="sources">Sources</button></div><button data-demo>Exemple fictif</button><button data-refresh aria-label="Actualiser">↻</button></header><div class="pmr-meta"></div><div class="pmr-warning" hidden></div><div class="pmr-body"></div>`;
  container.replaceChildren(style, root);
  let context = api.context;
  let snapshot: ReasoningSnapshot | null = null;
  let lastSerialized = '';
  let tab: Tab = 'graph';
  let editing = '';
  let scope = '';
  let selected = '';
  let zoom: number | null = null;
  let testValues: Record<string, string> = {};
  let lastRun: (ReasoningTestRun & { values: Record<string, ReasoningValue> }) | null = null;
  let sequence = 0;
  let stopped = false;
  let timer = 0;
  const body = root.querySelector<HTMLElement>('.pmr-body')!;
  const warning = root.querySelector<HTMLElement>('.pmr-warning')!;

  const source = (id: string) => snapshot?.sources.find((entry) => entry.id === id);
  const usedByFacts = () => new Set(snapshot?.facts.flatMap((fact) => fact.sources) ?? []);
  const kindLabel = (entry: ReasoningSource) => (entry.kind === 'article' ? 'Loi' : entry.kind === 'case' ? 'Jurisprudence' : usedByFacts().has(entry.id) ? 'Pièce' : 'Doctrine');
  const chips = (ids: string[]) => (ids.length ? `<div class="pmr-chips">${ids.map((id) => {
    const entry = source(id);
    const state = !entry ? ' · inconnue' : !entry.verified ? ' · introuvable' : entry.history?.status === 'remise en cause' ? ' · remise en cause' : '';
    return `<button class="pmr-chip" data-open="${escape(id)}" title="${escape(entry?.excerpt ?? id)}">${escape(entry ? `${kindLabel(entry)} · ${entry.title}` : id)}${escape(state)}</button>`;
  }).join('')}</div>` : '');
  const issues = (list: string[]) => (list.length ? `<ul class="pmr-issues">${list.map((issue) => `<li>${escape(issue)}</li>`).join('')}</ul>` : '');
  const review = (id: string, current?: ReasoningReview, fact = false) => {
    if (snapshot?.demo) return '';
    if (current) return `<div class="pmr-review">${badge(current.status, `${current.status === 'validé' ? 'Validé' : 'Écarté'} par l’avocat`)}${current.note ? `<span class="pmr-muted">${escape(current.note)}</span>` : ''}${fact ? `<button data-edit="${escape(id)}">Modifier</button>` : ''}<button data-review="${escape(id)}" data-status="">Annuler la décision</button></div>`;
    return `<div class="pmr-review"><button data-review="${escape(id)}" data-status="validé">Valider</button><button data-review="${escape(id)}" data-status="écarté">Écarter</button>${fact ? `<button data-edit="${escape(id)}">Modifier</button>` : ''}</div>`;
  };

  const lawCard = (condition: ReasoningCondition, conclusion = false) => `<div class="pmr-card law">
    <h4>${conclusion ? 'Conclusion · ' : ''}${escape(condition.label)}</h4>
    <div class="pmr-answer">${badge(condition.status)}${condition.strength ? `<span class="pmr-badge pmr-k-${condition.strength}">${STRENGTH_LABELS[condition.strength]}</span>` : ''}<code>${escape(condition.variable)}</code></div>
    ${chips(condition.sources)}${issues(condition.issues)}${review(condition.id, condition.review)}</div>`;

  const factForm = (fact: ReasoningFact) => {
    const value = fact.type === 'booléen'
      ? `<select name="value"><option value="vrai"${fact.value === true ? ' selected' : ''}>Vrai</option><option value="faux"${fact.value === false ? ' selected' : ''}>Faux</option></select>`
      : `<input name="value" ${fact.type === 'date' ? 'type="date"' : ''} value="${escape(fact.value === null ? '' : fact.type === 'durée' ? '' : fact.value)}" placeholder="${fact.type === 'durée' ? '5 an, 2 mois, 10 jour' : ''}" aria-label="Valeur">`;
    return `<form class="pmr-form" data-fact="${escape(fact.id)}">${value}<select name="force" aria-label="Force probante"><option value="">Force probante…</option>${REASONING_FORCES.map((force) => `<option value="${force}"${fact.force === force ? ' selected' : ''}>${FORCE_LABELS[force]}</option>`).join('')}</select><textarea name="appreciation" placeholder="Appréciation de la pièce" aria-label="Appréciation">${escape(fact.appreciation)}</textarea><input name="note" placeholder="Motif (facultatif)" aria-label="Motif"><div class="pmr-review"><button type="submit">Enregistrer et valider</button><button type="button" data-cancel>Annuler</button></div></form>`;
  };

  const factCard = (fact: ReasoningFact) => {
    const pieces = fact.sources.map(source).filter((entry): entry is ReasoningSource => Boolean(entry));
    return `<div class="pmr-card fact${fact.sources.length ? '' : ' missing'}">
      <h4>${escape(fact.variable)} = ${escape(formatValue(fact.value))}</h4>
      <div class="pmr-answer">${badge(fact.status)}${fact.force ? `<span class="pmr-badge">${escape(FORCE_LABELS[fact.force])}</span>` : ''}<span class="pmr-muted">appréciation : ${fact.author === 'avocat' ? 'avocat' : 'IA'}</span></div>
      ${fact.appreciation ? `<p class="pmr-muted">${escape(fact.appreciation)}</p>` : ''}
      ${chips(fact.sources)}${pieces.map((entry) => `<p class="pmr-excerpt">« ${escape(entry.excerpt)} »</p>`).join('')}
      ${issues(fact.issues)}${editing === fact.id ? factForm(fact) : review(fact.id, fact.review, true)}</div>`;
  };

  const questionView = (question: ReasoningQuestion) => {
    const conditions = question.conditions.map((id) => snapshot!.conditions.find((entry) => entry.id === id)!).filter(Boolean);
    const facts = snapshot!.facts.filter((fact) => fact.scope === question.scope);
    const resultId = `${question.scope}.${question.result}`;
    const linked = new Set<string>();
    const rows = conditions.filter((condition) => condition.id !== resultId).map((condition) => {
      const own = facts.filter((fact) => condition.dependsOn.includes(fact.id));
      own.forEach((fact) => linked.add(fact.id));
      return `${lawCard(condition)}<div class="pmr-arrow" aria-hidden="true">→</div><div>${own.length ? own.map(factCard).join('') : '<div class="pmr-card missing pmr-muted">Aucun fait rattaché.</div>'}</div>`;
    });
    const result = conditions.find((condition) => condition.id === resultId);
    const loose = facts.filter((fact) => !linked.has(fact.id));
    const vigueur = question.vigueur.map((entry) => `${escape(source(entry.source)?.title ?? entry.source)} : ${entry.inForce === true ? `en vigueur au ${formatValue(entry.date)}` : entry.inForce === false ? `non en vigueur au ${formatValue(entry.date)}` : 'vigueur indéterminée (date ou période inconnue)'}`).join(' · ');
    return `<article class="pmr-question">
      <h3>${escape(question.question || question.scope)}</h3>
      <div class="pmr-answer">${badge(question.status, `Réponse : ${question.status}`)}${question.valid ? '' : badge('indéterminée', 'Raisonnement incomplet')}<span class="pmr-muted">date de référence : ${escape(formatValue(question.referenceDate))}</span></div>
      ${issues(question.issues)}${vigueur ? `<p class="pmr-vigueur">Vigueur · ${vigueur}</p>` : ''}
      <div class="pmr-columns"><div class="pmr-colhead law">DROIT</div><div class="pmr-colhead gap"></div><div class="pmr-colhead fact">FAITS / PIÈCES</div>
      ${rows.join('')}
      ${loose.length ? `<div></div><div></div><div>${loose.map(factCard).join('')}</div>` : ''}
      ${result ? `${lawCard(result, true)}<div></div><div></div>` : ''}</div></article>`;
  };

  const currentQuestion = () => {
    const questions = snapshot?.questions ?? [];
    return questions.find((question) => question.scope === scope) ?? questions[0];
  };
  const questionPicker = () => ((snapshot?.questions.length ?? 0) > 1 ? `<select data-scope aria-label="Question">${snapshot!.questions.map((question) => `<option value="${escape(question.scope)}"${question.scope === currentQuestion()?.scope ? ' selected' : ''}>${escape(question.question || question.scope)}</option>`).join('')}</select>` : '');

  const graphOf = (question: ReasoningQuestion) => {
    const resultId = `${question.scope}.${question.result}`;
    const conditions = question.conditions.map((id) => snapshot!.conditions.find((entry) => entry.id === id)).filter((entry): entry is ReasoningCondition => Boolean(entry));
    const facts = snapshot!.facts.filter((fact) => fact.scope === question.scope);
    const nodes = new Map<string, GraphNode>();
    const edges: Array<[string, string]> = [];
    const add = (node: Omit<GraphNode, 'x' | 'y'>) => { if (!nodes.has(node.key)) nodes.set(node.key, { ...node, x: 0, y: 0 }); };
    const sourceStatus = (entry: ReasoningSource | undefined) => (!entry || !entry.verified || entry.history?.status === 'remise en cause' ? 'bloquée' : entry.history?.status === 'à examiner' ? 'indéterminée' : 'remplie');
    for (const condition of conditions) add({ key: condition.id, column: 1, label: condition.label, sub: condition.variable, status: condition.status, kind: condition.id === resultId ? 'result' : 'condition' });
    for (const condition of conditions) for (const id of condition.sources) {
      const entry = source(id);
      add({ key: `source:${id}`, column: 0, label: entry?.title ?? id, sub: entry ? kindLabel(entry) : 'source inconnue', status: sourceStatus(entry), kind: 'source' });
      edges.push([`source:${id}`, condition.id]);
    }
    for (const fact of facts) {
      const piece = fact.sources.length ? source(fact.sources[0])?.title ?? fact.sources[0] : 'pièce à rechercher';
      add({ key: fact.id, column: 2, label: `${fact.variable} = ${formatValue(fact.value)}`, sub: `${fact.sources.length > 1 ? `${fact.sources.length} pièces` : piece}`, status: fact.status, kind: 'fact' });
    }
    for (const condition of conditions) for (const dependency of condition.dependsOn) if (nodes.has(dependency)) edges.push([dependency, condition.id]);
    const order = new Map<string, number>(conditions.map((condition, index) => [condition.id, condition.id === resultId ? -1 : index]));
    const rank = (key: string): number => {
      if (order.has(key)) return order.get(key)!;
      const targets = edges.filter(([from]) => from === key).map(([, to]) => rank(to));
      return targets.length ? Math.min(...targets) + 0.5 : 999;
    };
    const columns = [0, 1, 2].map((column) => [...nodes.values()].filter((node) => node.column === column).sort((a, b) => rank(a.key) - rank(b.key)));
    const height = Math.max(...columns.map((column) => column.length), 1) * NODE.row + 40;
    columns.forEach((column, index) => column.forEach((node, row) => { node.x = 12 + index * NODE.column + (index ? 40 : 0); node.y = (height - column.length * NODE.row) / 2 + row * NODE.row + 7; }));
    return { nodes, edges, height };
  };

  const branch = (edges: Array<[string, string]>, key: string) => {
    const found = new Set([key]);
    const upstream = (current: string) => { for (const [from, to] of edges) if (to === current && !found.has(from)) { found.add(from); upstream(from); } };
    const downstream = (current: string) => { for (const [from, to] of edges) if (from === current && !found.has(to)) { found.add(to); downstream(to); } };
    upstream(key);
    downstream(key);
    return found;
  };

  const linkedCards = (question: ReasoningQuestion, key: string, members: Set<string>) => {
    const condition = snapshot!.conditions.find((entry) => entry.id === key);
    const fact = snapshot!.facts.find((entry) => entry.id === key);
    const facts = snapshot!.facts.filter((entry) => entry.scope === question.scope && members.has(entry.id) && entry.id !== key);
    const conditions = snapshot!.conditions.filter((entry) => entry.scope === question.scope && members.has(entry.id) && entry.id !== key);
    if (condition) return `<div class="pmr-columns"><div class="pmr-colhead law">DROIT</div><div class="pmr-colhead gap"></div><div class="pmr-colhead fact">FAITS / PIÈCES</div>${lawCard(condition, condition.variable === question.result)}<div class="pmr-arrow" aria-hidden="true">→</div><div>${facts.map(factCard).join('') || '<div class="pmr-card missing pmr-muted">Aucun fait rattaché.</div>'}</div>${conditions.filter((entry) => condition.dependsOn.includes(entry.id)).map((entry) => `${lawCard(entry)}<div></div><div></div>`).join('')}</div>`;
    if (fact) return `${factCard(fact)}${conditions.map((entry) => lawCard(entry, entry.variable === question.result)).join('')}`;
    const entry = source(key.replace(/^source:/, ''));
    if (!entry) return '';
    const citing = [...snapshot!.conditions.filter((item) => item.sources.includes(entry.id)).map((item) => lawCard(item, item.variable === question.result)), ...snapshot!.facts.filter((item) => item.sources.includes(entry.id)).map(factCard)];
    return `<div class="pmr-card"><h4>${escape(kindLabel(entry))} · ${escape(entry.title)}</h4><p class="pmr-excerpt">« ${escape(entry.excerpt)} »</p>${entry.history ? `<p class="pmr-muted">Historique judiciaire : ${escape(entry.history.status)}</p>` : ''}${entry.validity ? `<p class="pmr-muted">Version du ${formatValue(entry.validity.from)} au ${entry.validity.to ? formatValue(entry.validity.to) : 'terme non fixé'}</p>` : ''}<div class="pmr-review"><button data-open="${escape(entry.id)}">Ouvrir le passage</button></div></div>${citing.join('')}`;
  };

  const graphView = () => {
    const question = currentQuestion();
    if (!question) return '<p class="pmr-muted">Aucun champ d’application ne pose de question.</p>';
    const { nodes, edges, height } = graphOf(question);
    if (selected && !nodes.has(selected)) selected = '';
    const members = selected ? branch(edges, selected) : null;
    const width = 2 * NODE.column + NODE.width + 24 + 40;
    const scale = zoom ?? Math.max(0.55, Math.min(1, (body.clientWidth - 48) / width));
    const anchor = (node: GraphNode, side: 'left' | 'right') => [node.x + (side === 'right' ? NODE.width : 0), node.y + NODE.height / 2];
    let lane = 0;
    const paths = edges.map(([fromKey, toKey]) => {
      const from = nodes.get(fromKey)!, to = nodes.get(toKey)!;
      const active = !members || (members.has(fromKey) && members.has(toKey));
      const className = `pmr-edge${active ? '' : ' is-dim'}`;
      if (from.column === to.column) {
        const x = from.x - 8 - (lane++ % 4) * 7;
        const [x1, y1] = anchor(from, 'left');
        const [x2, y2] = anchor(to, 'left');
        return `<path class="${className}" d="M${x1},${y1} H${x} V${y2} H${x2 - 1}" marker-end="url(#pmr-arrow)"/>`;
      }
      const forward = from.column < to.column;
      const [x1, y1] = anchor(from, forward ? 'right' : 'left');
      const [x2, y2] = anchor(to, forward ? 'left' : 'right');
      const bend = (x2 - x1) / 2;
      return `<path class="${className}" d="M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}" marker-end="url(#pmr-arrow)"/>`;
    }).join('');
    const boxes = [...nodes.values()].map((node) => `<g class="pmr-node pmr-n-${node.kind}${members && !members.has(node.key) ? ' is-dim' : ''}${node.key === selected ? ' is-selected' : ''}" data-node="${escape(node.key)}" tabindex="0" role="button" aria-label="${escape(`${node.label} — ${node.status}`)}"><rect x="${node.x}" y="${node.y}" width="${NODE.width}" height="${NODE.height}" rx="8" class="pmr-s-${escape(slug(node.status))}"/><text x="${node.x + 9}" y="${node.y + 20}">${escape(shorten(node.label, 27))}</text><text class="pmr-sub" x="${node.x + 9}" y="${node.y + 38}">${escape(shorten(`${node.sub} · ${node.status}`, 32))}</text></g>`).join('');
    const heads = ['SOURCES DU DROIT', 'RÉPONSE ET CONDITIONS', 'FAITS / PIÈCES'].map((label, index) => `<text class="pmr-head-text ${index < 2 ? 'law' : 'fact'}" x="${12 + index * NODE.column + (index ? 40 : 0)}" y="14">${label}</text>`).join('');
    return `${questionPicker()}<article class="pmr-question"><h3>${escape(question.question || question.scope)}</h3><div class="pmr-answer">${badge(question.status, `Réponse : ${question.status}`)}${question.valid ? '' : badge('indéterminée', 'Raisonnement incomplet')}</div>${issues(question.issues)}
      <div class="pmr-graph-tools"><button data-zoom="-1" aria-label="Dézoomer">−</button><button data-zoom="1" aria-label="Zoomer">+</button><button data-fit>Ajuster</button></div><div class="pmr-graph" data-graph-width="${width}"><svg viewBox="0 0 ${width} ${height + 20}" width="${Math.round(width * scale)}" height="${Math.round((height + 20) * scale)}" role="group" aria-label="Graphe du raisonnement"><defs><marker id="pmr-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>${heads}<g transform="translate(0,20)">${paths}${boxes}</g></svg></div>
      <div class="pmr-linked">${selected ? `<div class="pmr-answer"><strong>Branche sélectionnée</strong><button data-unselect>Tout afficher</button></div>${linkedCards(question, selected, members!)}` : '<p class="pmr-muted">Cliquez sur une case du graphe : sa branche s’éclaire et les cases liées s’affichent ici.</p>'}</div></article>`;
  };

  const testsView = () => {
    const question = currentQuestion();
    if (!question) return '<p class="pmr-muted">Aucune question à tester.</p>';
    if (snapshot!.demo) return '<p class="pmr-muted">Les tests s’exécutent sur le raisonnement d’un dossier, pas sur l’exemple fictif.</p>';
    const facts = snapshot!.facts.filter((fact) => fact.scope === question.scope);
    const inputs = facts.map((fact) => {
      const raw = testValues[fact.id] ?? (fact.status === 'établi' ? rawValue(fact.value) : '');
      const field = fact.type === 'booléen'
        ? `<select data-test-input="${escape(fact.id)}"><option value="">Inconnu</option><option value="vrai"${raw === 'vrai' ? ' selected' : ''}>Vrai</option><option value="faux"${raw === 'faux' ? ' selected' : ''}>Faux</option></select>`
        : `<input data-test-input="${escape(fact.id)}" ${fact.type === 'date' ? 'type="date"' : ''} value="${escape(raw)}" placeholder="${fact.type === 'durée' ? '5 an, 2 mois, 10 jour' : 'inconnu'}">`;
      return `<label class="pmr-test-row"><span>${escape(fact.variable)} <small class="pmr-muted">${escape(fact.type)}${fact.status === 'établi' ? ' · établi au dossier' : ''}</small></span>${field}</label>`;
    }).join('');
    const run = lastRun && lastRun.question.scope === question.scope ? `<div class="pmr-card"><div class="pmr-answer"><strong>Résultat</strong>${badge(lastRun.question.status, `Réponse : ${lastRun.question.status}`)}</div>${lastRun.conditions.map((condition) => `<div class="pmr-answer">${badge(condition.status)}<span>${escape(condition.label)}</span></div>`).join('')}${issues(lastRun.question.issues)}<div class="pmr-review"><input data-test-label placeholder="Intitulé du test" aria-label="Intitulé du test"><button data-save-test>Enregistrer (attendu : ${escape(lastRun.question.status)})</button></div></div>` : '';
    const saved = snapshot!.tests.filter((entry) => entry.scope === question.scope).map((entry) => `<div class="pmr-card"><div class="pmr-answer">${badge(entry.passed ? 'remplie' : 'bloquée', entry.passed ? 'Réussi' : 'Échec')}<strong>${escape(entry.label)}</strong><span class="pmr-muted">attendu : ${escape(entry.expected)} · obtenu : ${escape(entry.actual ?? 'erreur')}</span><button data-delete-test="${escape(entry.id)}">Supprimer</button></div><p class="pmr-muted">${Object.entries(entry.values).map(([key, value]) => `${escape(key.split('.')[1])} = ${escape(formatValue(value))}`).join(' · ')}</p></div>`).join('');
    return `${questionPicker()}<article class="pmr-question"><h3>${escape(question.question || question.scope)}</h3><p class="pmr-muted">Hypothèses sur les faits (vide = inconnu), puis exécution du raisonnement actuel. Un test enregistré est rejoué à chaque révision.</p><div class="pmr-test">${inputs || '<p class="pmr-muted">Aucune entrée déclarée.</p>'}</div><div class="pmr-review"><button data-run-test>Exécuter le test</button><button data-reset-test>Valeurs du dossier</button></div>${run}<h4>Tests enregistrés</h4>${saved || '<p class="pmr-muted">Aucun test enregistré.</p>'}</article>`;
  };

  const paint = () => {
    root.dataset.theme = context.theme;
    root.querySelectorAll<HTMLElement>('[data-tab]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.tab === tab)));
    root.querySelector<HTMLElement>('[data-demo]')!.textContent = snapshot?.demo ? 'Revenir au dossier' : 'Exemple fictif';
    const meta = root.querySelector<HTMLElement>('.pmr-meta')!;
    if (!snapshot) { body.innerHTML = ''; meta.textContent = context.project ? 'Chargement…' : 'Aucun dossier ouvert.'; return; }
    const pending = [...snapshot.conditions, ...snapshot.facts].filter((item) => !item.review).length;
    meta.textContent = snapshot.demo ? 'EXEMPLE FICTIF · non enregistré dans le dossier' : snapshot.revision ? `Révision ${snapshot.revision} · ${pending} élément(s) à valider` : '';
    warning.hidden = !snapshot.diagnostics.length;
    warning.textContent = snapshot.diagnostics.join(' · ');
    if (!snapshot.code) { body.innerHTML = '<div class="pmr-empty"><strong>Aucun raisonnement</strong><p>Posez une question de droit dans le chat : le raisonnement (conditions, fondements, pièces) apparaît ici à la fin du tour, et chaque élément attend votre validation.</p></div>'; return; }
    if (tab === 'graph') body.innerHTML = graphView();
    else if (tab === 'tests') body.innerHTML = testsView();
    else if (tab === 'code') body.innerHTML = `<pre class="pmr-code">${escape(snapshot.code)}</pre>`;
    else if (tab === 'sources') body.innerHTML = snapshot.sources.map((entry) => `<div class="pmr-source"><div class="pmr-answer"><span class="pmr-badge">${escape(kindLabel(entry))}</span><button class="pmr-chip" data-open="${escape(entry.id)}">${escape(entry.title)}</button>${badge(entry.verified ? 'établi' : 'non établi', entry.verified ? (entry.repaired ? 'Extrait recalé' : 'Extrait vérifié') : 'Extrait introuvable')}<code>${escape(entry.id)}</code></div><p class="pmr-excerpt">« ${escape(entry.excerpt)} »</p>${entry.validity ? `<p class="pmr-muted">Version du ${formatValue(entry.validity.from)} au ${entry.validity.to ? formatValue(entry.validity.to) : 'terme non fixé'} (fin exclusive)</p>` : entry.kind === 'article' ? '<p class="pmr-muted">Période de vigueur inconnue</p>' : ''}${entry.history ? `<p class="pmr-muted">Historique judiciaire : ${escape(entry.history.status)}</p>${entry.history.lines.map((line) => `<p class="pmr-muted">· ${escape(line)}</p>`).join('')}` : ''}</div>`).join('') || '<p class="pmr-muted">Aucune source.</p>';
    else body.innerHTML = snapshot.questions.map(questionView).join('') || '<p class="pmr-muted">Aucun champ d’application ne pose de question.</p>';
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
      if (!editing && !body.contains(document.activeElement)) paint();
    } catch (error) {
      if (!stopped && request === sequence) showError(error);
    }
  };

  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('button');
    if (!button) return;
    if (button.dataset.tab) { tab = button.dataset.tab as Tab; paint(); }
    if (button.hasAttribute('data-demo')) { lastSerialized = ''; editing = ''; selected = ''; scope = ''; lastRun = null; void load(!snapshot?.demo); }
    if (button.hasAttribute('data-refresh')) { lastSerialized = ''; void load(Boolean(snapshot?.demo)); }
    if (button.dataset.open) {
      const entry = source(button.dataset.open);
      if (entry?.token) api.openFileInEditor?.(`piecemaker://citation/${entry.token}/${encodeURIComponent(entry.title)}`);
    }
    if (button.dataset.edit) { editing = button.dataset.edit; paint(); }
    if (button.hasAttribute('data-unselect')) { selected = ''; paint(); }
    if (button.dataset.zoom) {
      const current = Number(root.querySelector<SVGSVGElement>('.pmr-graph svg')?.getAttribute('width')) / Number(root.querySelector<HTMLElement>('[data-graph-width]')?.dataset.graphWidth) || 1;
      zoom = Math.max(0.4, Math.min(2, current * (Number(button.dataset.zoom) > 0 ? 1.2 : 1 / 1.2)));
      paint();
    }
    if (button.hasAttribute('data-fit')) {
      const graph = root.querySelector<HTMLElement>('[data-graph-width]');
      if (graph) { zoom = null; paint(); }
    }
    if (button.hasAttribute('data-reset-test')) { testValues = {}; lastRun = null; paint(); }
    if (button.hasAttribute('data-run-test') && context.project) {
      const question = currentQuestion();
      if (!question) return;
      try {
        const values = Object.fromEntries(snapshot!.facts.filter((fact) => fact.scope === question.scope).map((fact) => {
          const raw = testValues[fact.id] ?? (fact.status === 'établi' ? rawValue(fact.value) : '');
          return [fact.id, raw === '' ? null : parseInput(fact.type, raw)];
        }));
        void runTest(context.project.path, question.scope, values).then((result) => { lastRun = { ...result, values }; paint(); }).catch(showError);
      } catch (error) { showError(error); }
    }
    if (button.hasAttribute('data-save-test') && context.project && lastRun) {
      const label = root.querySelector<HTMLInputElement>('[data-test-label]')?.value.trim() ?? '';
      if (!label) { showError(new Error('Donnez un intitulé au test.')); return; }
      void saveTest(context.project.path, { label, scope: lastRun.question.scope, values: lastRun.values, expected: lastRun.question.status }).then((data) => { lastRun = null; apply(data); }).catch(showError);
    }
    if (button.dataset.deleteTest && context.project) void deleteTest(context.project.path, button.dataset.deleteTest).then(apply).catch(showError);
    if (button.hasAttribute('data-cancel')) { editing = ''; paint(); }
    if (button.dataset.review && context.project && !snapshot?.demo) {
      const status = (button.dataset.status || null) as 'validé' | 'écarté' | null;
      const note = status ? window.prompt(status === 'validé' ? 'Motif de la validation (facultatif)' : 'Motif du rejet (facultatif)') ?? undefined : undefined;
      void reviewItem(context.project.path, button.dataset.review, status, note).then(apply).catch(showError);
    }
  });
  root.addEventListener('input', (event) => {
    const input = (event.target as Element).closest<HTMLInputElement | HTMLSelectElement>('[data-test-input]');
    if (input) testValues[input.dataset.testInput!] = input.value;
  });
  root.addEventListener('change', (event) => {
    const picker = (event.target as Element).closest<HTMLSelectElement>('[data-scope]');
    if (picker) { scope = picker.value; selected = ''; lastRun = null; paint(); }
  });
  const pick = (target: EventTarget | null) => {
    const key = (target as Element | null)?.closest<SVGGElement>('[data-node]')?.dataset.node;
    if (key) { selected = selected === key ? '' : key; paint(); }
  };
  root.addEventListener('click', (event) => pick(event.target));
  root.addEventListener('keydown', (event) => { if ((event.key === 'Enter' || event.key === ' ') && (event.target as Element).closest('[data-node]')) { event.preventDefault(); pick(event.target); } });
  root.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = (event.target as Element).closest<HTMLFormElement>('form[data-fact]');
    const fact = snapshot?.facts.find((entry) => entry.id === form?.dataset.fact);
    if (!form || !fact || !context.project) return;
    const data = new FormData(form);
    try {
      const value = parseInput(fact.type, String(data.get('value') ?? ''));
      void appreciateFact(context.project.path, fact.id, { value, force: String(data.get('force') || '') || null, appreciation: String(data.get('appreciation') ?? ''), note: String(data.get('note') ?? '') || undefined }).then(apply).catch(showError);
    } catch (error) { showError(error); }
  });

  const unsubscribe = api.onContextChange((next) => {
    const changed = next.project?.path !== context.project?.path;
    context = next;
    if (changed) { sequence++; snapshot = null; lastSerialized = ''; editing = ''; scope = ''; selected = ''; testValues = {}; lastRun = null; void load(); }
    paint();
  });
  const poll = () => { if (!stopped) { if (!snapshot?.demo) void load(); timer = window.setTimeout(poll, 2500); } };
  paint();
  void load();
  timer = window.setTimeout(poll, 2500);
  window.dispatchEvent(new CustomEvent('piecemaker:panel-focus', { detail: { tab: 'plugin:piecemaker-raisonnement' } }));
  cleanups.set(container, () => { stopped = true; sequence++; window.clearTimeout(timer); unsubscribe(); container.replaceChildren(); });
}

export function unmount(container: HTMLElement) {
  cleanups.get(container)?.();
  cleanups.delete(container);
}
