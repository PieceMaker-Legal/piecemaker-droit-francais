import type { Clause, Reasoning, Source, Step } from './graph.js';
import { applicationMarkup, conditionApplication } from './condition-application.js';

type MapNode = { id: string; card: string; kind: string; title: string; value: string; sources: Source[]; warning: string; open: boolean; application?: ReturnType<typeof conditionApplication> };
type Link = { from: string; to: string; label: string };
const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const kinds: Record<string, string> = { answer: 'Conclusion du scénario', rule: 'Règle / qualification', condition: 'Condition de droit', exception: 'Exception de droit', group: 'Conditions', fact: 'Donnée du dossier' };

export function reasoningMap(model: Reasoning, human: (text: string) => string, sourceLink: (source: Source) => string) {
  if (!model.steps.length) return '';
  const steps = new Map(model.steps.map((step) => [step.id, step]));
  const nodes = new Map<string, MapNode>();
  const links: Link[] = [];
  const applications = new Map(model.steps.map((step) => [step.id, conditionApplication(step, model)]));
  const collapsed = new Set(model.steps.filter((step) => applications.get(step.id)?.folded.length && step.parents.every((id) => steps.get(id)?.kind === 'fact') && model.steps.some((owner) => owner.parents.includes(step.id))).map((step) => step.id));
  const folded = new Set([...collapsed].flatMap((id) => applications.get(id)?.folded ?? []));
  const direct = new Set(model.steps.filter((step) => !collapsed.has(step.id)).flatMap((step) => step.parents));
  const link = (from: string, to: string, label: string) => {
    if (from !== to && !links.some((entry) => entry.from === from && entry.to === to)) links.push({ from, to, label });
  };
  for (const step of model.steps) {
    if (folded.has(step.id) && !direct.has(step.id)) continue;
    const application = applications.get(step.id);
    const sources = step.sources.filter((source) => step.kind !== 'fact' || source.kind === 'piece');
    const warning = step.notes.recherche || (step.kind === 'fact' && !sources.length ? 'Pièce à rattacher' : step.issue ? step.kind === 'fact' ? 'Fait à examiner' : 'Fondement à compléter' : sources.some((source) => source.status === 'failed') ? 'Citation à vérifier' : '');
    nodes.set(step.id, { id: step.id, card: step.id, kind: step.answer ? 'answer' : application?.kind ?? step.kind, title: step.notes.question || step.title, value: step.value.startsWith('{') || step.value.startsWith('[') ? '' : step.value, sources, warning, open: Boolean(warning || application && (!application.basis.length || !application.facts.length || !application.pieces.length)), application });
  }
  const clauseNode = (clause: Clause, owner: Step, path: string): string => {
    if (clause.kind === 'leaf' && steps.has(clause.ref)) return clause.ref;
    const id = `${owner.id}-${path}`;
    const title = clause.kind === 'all' ? 'Toutes ces conditions' : clause.kind === 'any' ? 'L’une de ces conditions' : clause.kind === 'not' ? 'Cette condition doit être fausse' : human(clause.text);
    const application = clause.kind === 'leaf' && /^(?:Vrai|Faux)$/.test(owner.value) ? conditionApplication(owner, model, clause) : null;
    nodes.set(id, { id, card: owner.id, kind: application?.kind ?? (clause.kind === 'leaf' ? 'rule' : 'group'), title, value: '', sources: [], warning: '', open: Boolean(application && (!application.basis.length || !application.facts.length || !application.pieces.length)), application });
    clause.members.forEach((member, index) => link(id, clauseNode(member, owner, `${path}-${index}`), clause.kind === 'any' ? 'ou' : clause.kind === 'not' ? 'non' : 'et'));
    if (clause.kind === 'leaf' && !application) for (const ref of clause.refs) if (steps.has(ref)) link(id, ref, 'selon');
    return id;
  };
  for (const step of model.steps) {
    if (!nodes.has(step.id)) continue;
    if (collapsed.has(step.id)) continue;
    const covered = new Set<string>();
    const collect = (clause: Clause) => { clause.refs.forEach((ref) => covered.add(ref)); clause.members.forEach(collect); };
    if (step.clause) { collect(step.clause); link(step.id, clauseNode(step.clause, step, 'condition'), 'si'); }
    const exception = step.origins.some((origin) => origin.role === 'definition' && origin.selected && origin.overrides);
    for (const parent of step.parents) if (!covered.has(parent)) link(step.id, parent, exception ? 'sauf' : step.conditional ? 'si' : 'selon');
  }
  const connected = new Set(links.flatMap((edge) => [edge.from, edge.to]));
  if (model.steps.some((step) => step.kind === 'rule')) for (const step of model.steps) if (step.kind === 'fact' && !connected.has(step.id)) nodes.delete(step.id);
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
  const card = (node: MapNode) => `<div class="pmc-map-node" data-node="${node.id}" data-card="${node.card}" data-kind="${node.kind}" data-open="${node.open}" tabindex="0" role="button" aria-pressed="false"><span class="pmc-node-label">${kinds[node.kind]}</span><div class="pmc-node-title">${escape(node.title)}</div>${node.application ? applicationMarkup(node.application, sourceLink) : node.sources.length ? `<div class="pmc-map-refs">${node.sources.map((source) => sourceLink(source)).join('')}</div>` : ''}${node.value ? `<div class="pmc-case-value"><span>Dans ce scénario</span> <span class="pmc-value pmc-neutral" title="Valeur dans le scénario choisi">${escape(node.value)}</span></div>` : ''}${node.warning ? `<p class="pmc-warn">${escape(node.warning)}</p>` : node.open && node.kind === 'answer' ? '<p class="pmc-warn">Justification à compléter</p>' : ''}</div>`;
  const count = [...nodes.values()].filter((node) => node.warning || node.application && (!node.application.basis.length || !node.application.facts.length || !node.application.pieces.length)).length;
  const unused = model.others.length ? `<details class="pmc-unused"><summary>${model.others.length} source${model.others.length > 1 ? 's' : ''} citée${model.others.length > 1 ? 's' : ''} à rattacher</summary><p>Le programme ne précise pas quel élément ces sources justifient.</p><div class="pmc-map-refs">${model.others.map((source) => sourceLink(source)).join('')}</div></details>` : '';
  return `<div class="pmc-map-summary">${count ? `${count} point${count > 1 ? 's' : ''} à compléter` : 'Aucun manque détecté dans les éléments représentés.'}<span>Les valeurs Vrai / Faux décrivent le scénario choisi. Elles ne prouvent pas les faits.</span></div>${unused}<div class="pmc-map" aria-label="Conditions du raisonnement et faits à examiner"><svg class="pmc-map-links" aria-hidden="true">${links.map((edge) => `<g data-from="${edge.from}" data-to="${edge.to}" data-relation="${edge.label}"><path/><text>${edge.label}</text></g>`).join('')}</svg>${columns.map((column) => `<div class="pmc-map-column">${column.map(card).join('')}</div>`).join('')}</div>`;
}
