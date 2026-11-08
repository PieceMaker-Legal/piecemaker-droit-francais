import type { Clause, Reasoning, Source, Step } from './graph.js';

type MapNode = { id: string; card: string; kind: string; title: string; detail: string; value: string; open: boolean; html?: string };
type Link = { from: string; to: string; label: string };
const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const kinds: Record<string, string> = { answer: 'Question / conclusion', rule: 'Qualification / règle', condition: 'Condition', fact: 'Donnée du scénario', article: 'Texte', jurisprudence: 'Jurisprudence', reference: 'Autre référence', piece: 'Pièce citée', action: 'Point ouvert' };

export function reasoningMap(model: Reasoning, human: (text: string) => string, sourceLink: (source: Source) => string) {
  if (!model.steps.length) return '';
  const steps = new Map(model.steps.map((step) => [step.id, step]));
  const nodes = new Map<string, MapNode>();
  const links: Link[] = [];
  const link = (from: string, to: string, label: string) => {
    if (from !== to && !links.some((entry) => entry.from === from && entry.to === to && entry.label === label)) links.push({ from, to, label });
  };
  const action = (owner: string, card: string, title: string, detail = '') => {
    const id = `action-${nodes.size}`;
    nodes.set(id, { id, card, kind: 'action', title, detail, value: '', open: true });
    link(owner, id, 'à résoudre');
  };
  const sources = new Map<string, string>();
  const sourceNode = (source: Source, card: string) => {
    const key = JSON.stringify([source.origin, source.target, source.quote]);
    const existing = sources.get(key);
    if (existing) return existing;
    const id = `source-${sources.size}`;
    sources.set(key, id);
    const open = source.status !== 'passed';
    nodes.set(id, { id, card, kind: source.kind, title: source.title || source.label, detail: source.quote, value: source.status === 'passed' ? 'Extrait retrouvé' : source.status === 'failed' ? 'Citation non retrouvée' : 'Citation à vérifier', open, html: sourceLink(source) });
    if (open) action(id, card, source.status === 'failed' ? 'Corriger la citation ou son rattachement' : 'Vérifier la citation dans sa source');
    return id;
  };
  for (const step of model.steps) {
    const piece = step.sources.some((source) => source.kind === 'piece');
    const open = Boolean(step.issue || step.notes.recherche || step.sources.some((source) => source.status !== 'passed'));
    const tested = step.tests.length ? `Exercé par : ${step.tests.join(', ')}.` : '';
    nodes.set(step.id, { id: step.id, card: step.id, kind: step.answer ? 'answer' : step.kind, title: step.notes.question || step.title, detail: [step.notes.justification, step.kind === 'fact' ? piece ? 'Pièce citée ; qualification à confirmer.' : 'Hypothèse du scénario ; aucune pièce citée.' : '', tested].filter(Boolean).join(' '), value: step.value, open });
  }
  const clauseNode = (clause: Clause, owner: Step, path: string): string => {
    if (clause.kind === 'leaf' && steps.has(clause.ref)) return clause.ref;
    const id = `${owner.id}-${path}`;
    const title = clause.kind === 'all' ? 'ET' : clause.kind === 'any' ? 'OU' : clause.kind === 'not' ? 'NON' : human(clause.text);
    const detail = clause.kind === 'all' ? 'Toutes les conditions sont requises.' : clause.kind === 'any' ? 'Une seule condition suffit.' : clause.kind === 'not' ? 'La condition doit être fausse.' : 'Expression calculée par Catala.';
    nodes.set(id, { id, card: owner.id, kind: 'condition', title, detail, value: clause.met === 'ok' ? 'Vrai' : clause.met === 'ko' ? 'Faux' : '', open: false });
    clause.members.forEach((member, index) => link(id, clauseNode(member, owner, `${path}-${index}`), clause.kind === 'not' ? 'écarte' : 'requiert'));
    if (clause.kind === 'leaf') for (const ref of clause.refs) if (steps.has(ref)) link(id, ref, 'utilise');
    return id;
  };
  for (const step of model.steps) {
    const covered = new Set<string>();
    const collect = (clause: Clause) => { clause.refs.forEach((ref) => covered.add(ref)); clause.members.forEach(collect); };
    if (step.clause) {
      collect(step.clause);
      link(step.id, clauseNode(step.clause, step, 'condition'), 'requiert');
    }
    for (const parent of step.parents) if (!covered.has(parent)) link(step.id, parent, step.conditional ? 'condition appliquée' : 'utilise');
    for (const source of step.sources) link(step.id, sourceNode(source, step.id), source.kind === 'piece' ? 'pièce citée' : source.kind === 'reference' ? 'référence' : 'fondement');
    if (step.notes.recherche || step.issue) action(step.id, step.id, step.notes.recherche || step.issue, step.notes.recherche ? step.issue : '');
  }
  for (const source of model.others) {
    const node = nodes.get(sourceNode(source, ''))!;
    if (!links.some((edge) => edge.to === node.id)) node.detail = `Source non rattachée à un élément de cette exécution. ${node.detail}`;
  }
  for (let pass = 0; pass < nodes.size; pass++) {
    let changed = false;
    for (const edge of links) {
      const from = nodes.get(edge.from)!;
      if (nodes.get(edge.to)?.open && !from.open) { from.open = true; changed = true; }
    }
    if (!changed) break;
  }
  const levels = new Map([...nodes.keys()].map((id) => [id, 0]));
  for (let pass = 0; pass < nodes.size; pass++) {
    let changed = false;
    for (const edge of links) {
      const next = levels.get(edge.from)! + 1;
      if (next > levels.get(edge.to)!) { levels.set(edge.to, next); changed = true; }
    }
    if (!changed) break;
    if (pass === nodes.size - 1) throw new Error('Le graphe du raisonnement contient un cycle.');
  }
  const columns = Array.from({ length: Math.max(...levels.values()) + 1 }, () => [] as MapNode[]);
  nodes.forEach((node) => columns[levels.get(node.id)!].push(node));
  const card = (node: MapNode) => `<div class="pmc-map-node" data-node="${node.id}" data-card="${node.card}" data-kind="${node.kind}" data-open="${node.open}"${node.card ? ' tabindex="0" role="button" aria-pressed="false"' : ''}><span class="pmc-node-label">${kinds[node.kind] || kinds.rule}</span><div class="pmc-node-title">${node.html || escape(node.title)}</div>${node.value ? `<span class="pmc-value pmc-neutral">${escape(node.value)}</span>` : ''}${node.detail ? `<p class="pmc-node-note">${escape(node.detail)}</p>` : ''}${node.open && (node.kind === 'rule' || node.kind === 'answer') ? '<span class="pmc-warn">Justification à compléter</span>' : ''}</div>`;
  const count = [...nodes.values()].filter((node) => node.kind === 'action').length;
  return `<div class="pmc-map-summary">${count ? `${count} point${count > 1 ? 's' : ''} ouvert${count > 1 ? 's' : ''}` : 'Aucun manque détecté dans les éléments représentés.'}<span>Les valeurs décrivent le scénario. Les citations ne prouvent pas les faits.</span></div><div class="pmc-map" aria-label="Relations entre conclusion, conditions, données, sources et points ouverts"><svg class="pmc-map-links" aria-hidden="true">${links.map((edge) => `<g data-from="${edge.from}" data-to="${edge.to}" data-relation="${escape(edge.label)}"><path/><text>${escape(edge.label)}</text></g>`).join('')}</svg>${columns.map((column) => `<div class="pmc-map-column">${column.map(card).join('')}</div>`).join('')}</div>`;
}
