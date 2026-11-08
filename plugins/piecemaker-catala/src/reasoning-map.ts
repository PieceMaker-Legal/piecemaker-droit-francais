import type { Clause, Reasoning, Source, Step } from './graph.js';
import { conditionApplication } from './condition-application.js';

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const legal = (source: Source) => source.kind === 'article' || source.kind === 'jurisprudence';

export function reasoningMap(model: Reasoning, human: (text: string) => string, sourceLink: (source: Source) => string) {
  if (!model.steps.length) return '';
  const steps = new Map(model.steps.map((step) => [step.id, step]));
  const rules = model.steps.filter((step) => step.kind === 'rule');
  const displayed: Step[] = [];
  const visited = new Set<string>();
  const visit = (step: Step) => {
    if (visited.has(step.id)) return;
    visited.add(step.id);
    for (const id of step.parents) { const parent = steps.get(id); if (parent?.kind === 'rule') visit(parent); }
    displayed.push(step);
  };
  const used = new Set(rules.flatMap((step) => step.parents));
  rules.filter((step) => step.answer || !used.has(step.id)).forEach(visit);
  (rules.length ? rules : model.steps).forEach(visit);
  const incomplete = new Set<string>();
  for (const step of model.steps) if (step.issue || step.notes.recherche || step.sources.some((source) => source.status === 'failed') || step.parents.some((id) => incomplete.has(id))) incomplete.add(step.id);
  const links = rules.flatMap((step) => step.parents.filter((id) => steps.get(id)?.kind === 'rule').map((id) => ({ from: id, to: step.id })));
  const internalLinks: Array<{ owner: string; from: string; to: string; route: string }> = [];
  let conditionIndex = 0;
  const references = (sources: Source[]) => sources.length ? `<div class="pmc-map-refs">${sources.map((source) => sourceLink(source)).join('')}</div>` : '';
  const quotation = (source: Source) => source.quote ? `<q>${escape(source.quote)}</q>` : '';
  const value = (step: Step) => (step.value.startsWith('{') || step.value.startsWith('[')) ? '' : `<span class="pmc-value pmc-neutral">${escape(step.value || 'Indéterminé')}</span>`;
  const support = (step: Step): string => {
    if (step.kind === 'rule') return `<p class="pmc-prior-result">Résultat déjà obtenu : <a href="#" class="pmc-link" data-goto="${step.id}">${escape(step.title)}</a> ${value(step)}${incomplete.has(step.id) ? '<span class="pmc-warn">Justification à compléter</span>' : ''}</p>`;
    const pieces = step.sources.filter((source) => source.kind === 'piece');
    return `<div class="pmc-observation"><p><a href="#" class="pmc-link" data-goto="${step.id}">${escape(step.title)}</a> : ${value(step)}</p>${pieces.map(quotation).join('')}<div data-part="evidence">${references(pieces)}${!pieces.length ? '<p class="pmc-warn">Pièce à rattacher</p>' : ''}${pieces.some((source) => source.status === 'failed') ? '<p class="pmc-warn">Citation non retrouvée dans la pièce</p>' : ''}</div>${step.issue && pieces.length ? `<p class="pmc-warn">${escape(step.issue)}</p>` : ''}</div>`;
  };
  const condition = (clause: Clause, owner: Step): string => {
    if (clause.kind !== 'leaf') {
      const title = clause.kind === 'all' ? 'Toutes ces conditions doivent être réunies' : clause.kind === 'any' ? 'Au moins une de ces conditions doit être réunie' : 'La condition suivante doit être fausse';
      return `<li class="pmc-condition-group" data-op="${clause.kind}"><p>${title}</p><ul>${clause.members.map((member) => condition(member, owner)).join('')}</ul></li>`;
    }
    const referenced = steps.get(clause.ref);
    const supporting = (referenced ? [referenced] : clause.refs.map((id) => steps.get(id))).filter((step): step is Step => Boolean(step));
    const application = referenced ? conditionApplication(referenced, model) : null;
    const foundation = application?.basis ?? [];
    const title = referenced ? referenced.notes.question || referenced.title : human(clause.text);
    const anchor = `${owner.id}-condition-${conditionIndex++}`;
    internalLinks.push({ owner: owner.id, from: `${owner.id}-law`, to: anchor, route: 'requires' }, { owner: owner.id, from: `${anchor}-proof`, to: anchor, route: 'supports' });
    return `<li class="pmc-condition-row" data-condition="${referenced?.id ?? ''}"><section class="pmc-flow-box" data-part="condition" data-flow-anchor="${anchor}"><span class="pmc-box-kind">Condition</span><h4>${escape(title)}</h4>${references(foundation)}</section><section class="pmc-flow-box" data-part="facts" data-flow-anchor="${anchor}-proof"><span class="pmc-box-kind">Faits et pièces</span>${supporting.length ? supporting.map(support).join('') : '<p class="pmc-warn">Application au dossier à préciser</p>'}</section></li>`;
  };
  const card = (step: Step) => {
    const exception = step.origins.some((origin) => origin.selected && origin.role === 'definition' && origin.overrides);
    const foundation = step.sources.filter(legal);
    const inputs = step.clause ? condition(step.clause, step) : step.parents.length ? step.parents.map((id) => condition({ kind: 'leaf', text: '', ref: id, refs: [id], members: [], met: '' }, step)).join('') : '<li class="pmc-condition-row"><section data-part="condition"><p>Aucune condition supplémentaire dans cette définition.</p></section><section data-part="facts"><p>Valeur fixée par la définition appliquée.</p></section></li>';
    const warning = step.notes.recherche || (foundation.length ? '' : 'Fondement juridique à préciser');
    const open = Boolean(warning || incomplete.has(step.id));
    internalLinks.push({ owner: step.id, from: `${step.id}-law`, to: `${step.id}-outcome`, route: 'consequence' });
    return `<article class="pmc-map-node pmc-inference" data-node="${step.id}" data-card="${step.id}" data-kind="${step.answer ? 'answer' : exception ? 'exception' : step.kind}" data-open="${open}" tabindex="0" role="button" aria-pressed="false"><div class="pmc-inference-grid"><section class="pmc-major pmc-flow-box" data-part="law" data-flow-anchor="${step.id}-law"><div class="pmc-inference-heading"><span>${exception ? 'Exception appliquée' : step.kind === 'fact' ? 'Donnée du scénario' : 'Règle et application au dossier'}</span><h3>${escape(step.notes.question || step.title)}</h3></div><h4>${exception ? 'Exception de droit' : 'Règle de droit'}</h4>${foundation.map((source) => `${quotation(source)}${references([source])}`).join('') || '<p class="pmc-warn">Fondement juridique à préciser</p>'}${step.sources.some((source) => source.kind === 'reference') ? `<details><summary>Autres références citées</summary>${references(step.sources.filter((source) => source.kind === 'reference'))}</details>` : ''}${foundation.some((source) => source.status === 'failed') ? '<p class="pmc-warn">Citation juridique à vérifier</p>' : ''}</section><section class="pmc-application-table"><ul class="pmc-conditions">${step.kind === 'fact' ? `<li class="pmc-condition-row"><section data-part="condition">${escape(step.title)}</section><section data-part="facts">${support(step)}</section></li>` : inputs}</ul></section></div><div class="pmc-inference-down" aria-hidden="true"></div><div class="pmc-consequence pmc-flow-box" data-flow-anchor="${step.id}-outcome"><span>${step.answer ? 'Conclusion juridique dans ce scénario' : 'Conséquence dans ce scénario'}</span><strong>${escape(step.title)}</strong>${value(step)}</div>${step.notes.recherche ? `<p class="pmc-warn">À rechercher : ${escape(step.notes.recherche)}</p>` : ''}</article>`;
  };
  const unused = model.others.length ? `<details class="pmc-unused"><summary>${model.others.length} source${model.others.length > 1 ? 's' : ''} à rattacher</summary>${references(model.others)}</details>` : '';
  const cards = displayed.map(card).join('');
  return `<div class="pmc-map-summary">Lecture de haut en bas : chaque conséquence peut servir à l’application d’une autre règle.<span>Sur une même ligne : règle de droit, conditions, faits et pièces. Vrai / Faux reste la valeur du scénario.</span></div>${unused}<div class="pmc-map" data-layout="legal" aria-label="Règles, conditions et faits à l’horizontale ; conséquences vers le bas"><svg class="pmc-map-links" aria-hidden="true"><defs><marker id="pmc-flow-head" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><polygon points="0,0 8,4 0,8"/></marker></defs>${links.map((edge) => `<g data-from="${edge.from}" data-to="${edge.to}" data-relation="alimente" data-anchor-from="${edge.from}-outcome" data-anchor-to="${edge.to}-law"><path marker-end="url(#pmc-flow-head)"/></g>`).join('')}${internalLinks.map((edge) => `<g data-from="${edge.owner}" data-to="${edge.owner}" data-route="${edge.route}" data-anchor-from="${edge.from}" data-anchor-to="${edge.to}"><path marker-end="url(#pmc-flow-head)"/></g>`).join('')}</svg>${cards}</div>`;
}
