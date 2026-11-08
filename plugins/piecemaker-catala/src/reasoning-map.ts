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
  const references = (sources: Source[]) => sources.length ? `<div class="pmc-map-refs">${sources.map((source) => sourceLink(source)).join('')}</div>` : '';
  const quotation = (source: Source) => source.quote ? `<q>${escape(source.quote)}</q>` : '';
  const value = (step: Step) => (step.value.startsWith('{') || step.value.startsWith('[')) ? '' : `<span class="pmc-value pmc-neutral">${escape(step.value || 'Indéterminé')}</span>`;
  const support = (step: Step): string => {
    if (step.kind === 'rule') return `<p class="pmc-prior-result">Résultat déjà obtenu : <a href="#" class="pmc-link" data-goto="${step.id}">${escape(step.title)}</a> ${value(step)}${incomplete.has(step.id) ? '<span class="pmc-warn">Justification à compléter</span>' : ''}</p>`;
    const pieces = step.sources.filter((source) => source.kind === 'piece');
    return `<div class="pmc-observation"><p><a href="#" class="pmc-link" data-goto="${step.id}">${escape(step.title)}</a> : ${value(step)}</p>${pieces.map(quotation).join('')}<div data-part="evidence">${references(pieces)}${!pieces.length ? '<p class="pmc-warn">Pièce à rattacher</p>' : ''}${pieces.some((source) => source.status === 'failed') ? '<p class="pmc-warn">Citation non retrouvée dans la pièce</p>' : ''}</div>${step.issue && pieces.length ? `<p class="pmc-warn">${escape(step.issue)}</p>` : ''}</div>`;
  };
  const condition = (clause: Clause): string => {
    if (clause.kind !== 'leaf') {
      const title = clause.kind === 'all' ? 'Toutes ces conditions doivent être réunies' : clause.kind === 'any' ? 'Au moins une de ces conditions doit être réunie' : 'La condition suivante doit être fausse';
      return `<li class="pmc-condition-group" data-op="${clause.kind}"><p>${title}</p><ul>${clause.members.map((member) => condition(member)).join('')}</ul></li>`;
    }
    const referenced = steps.get(clause.ref);
    const supporting = (referenced ? [referenced] : clause.refs.map((id) => steps.get(id))).filter((step): step is Step => Boolean(step));
    const application = referenced ? conditionApplication(referenced, model) : null;
    const foundation = application?.basis ?? [];
    const title = referenced ? referenced.notes.question || referenced.title : human(clause.text);
    return `<li class="pmc-condition-row" data-condition="${referenced?.id ?? ''}"><section data-part="condition"><h4>${escape(title)}</h4>${references(foundation)}</section><section data-part="facts">${supporting.length ? supporting.map(support).join('') : '<p class="pmc-warn">Application au dossier à préciser</p>'}</section></li>`;
  };
  const card = (step: Step) => {
    const exception = step.origins.some((origin) => origin.selected && origin.role === 'definition' && origin.overrides);
    const foundation = step.sources.filter(legal);
    const inputs = step.clause ? condition(step.clause) : step.parents.length ? step.parents.map((id) => condition({ kind: 'leaf', text: '', ref: id, refs: [id], members: [], met: '' })).join('') : '<li class="pmc-condition-row"><section data-part="condition"><p>Aucune condition supplémentaire dans cette définition.</p></section><section data-part="facts"><p>Valeur fixée par la définition appliquée.</p></section></li>';
    const warning = step.notes.recherche || (foundation.length ? '' : 'Fondement juridique à préciser');
    const open = Boolean(warning || incomplete.has(step.id));
    return `<article class="pmc-map-node pmc-inference" data-node="${step.id}" data-card="${step.id}" data-kind="${step.answer ? 'answer' : exception ? 'exception' : step.kind}" data-open="${open}" tabindex="0" role="button" aria-pressed="false"><div class="pmc-inference-heading"><span>${exception ? 'Exception appliquée' : step.kind === 'fact' ? 'Donnée du scénario' : 'Règle et application au dossier'}</span><h3>${escape(step.notes.question || step.title)}</h3></div><div class="pmc-inference-grid"><section class="pmc-major" data-part="law"><h4>${exception ? 'Exception de droit' : 'Règle de droit'}</h4>${foundation.map((source) => `${quotation(source)}${references([source])}`).join('') || '<p class="pmc-warn">Fondement juridique à préciser</p>'}${step.sources.some((source) => source.kind === 'reference') ? `<details><summary>Autres références citées</summary>${references(step.sources.filter((source) => source.kind === 'reference'))}</details>` : ''}${foundation.some((source) => source.status === 'failed') ? '<p class="pmc-warn">Citation juridique à vérifier</p>' : ''}</section><section class="pmc-application-table"><div class="pmc-application-head"><span>Conditions</span><span>Ce qui permet de les apprécier</span></div><ul class="pmc-conditions">${step.kind === 'fact' ? `<li class="pmc-condition-row"><section data-part="condition">${escape(step.title)}</section><section data-part="facts">${support(step)}</section></li>` : inputs}</ul></section></div><div class="pmc-inference-down" aria-hidden="true">↓</div><div class="pmc-consequence"><span>${step.answer ? 'Conclusion juridique dans ce scénario' : 'Conséquence dans ce scénario'}</span><strong>${escape(step.title)}</strong>${value(step)}</div>${step.notes.recherche ? `<p class="pmc-warn">À rechercher : ${escape(step.notes.recherche)}</p>` : ''}</article>`;
  };
  const unused = model.others.length ? `<details class="pmc-unused"><summary>${model.others.length} source${model.others.length > 1 ? 's' : ''} à rattacher</summary>${references(model.others)}</details>` : '';
  return `<div class="pmc-map-summary">Lecture de haut en bas : chaque conséquence peut servir à l’application d’une autre règle.<span>Sur une même ligne : règle de droit, conditions, faits et pièces. Vrai / Faux reste la valeur du scénario.</span></div>${unused}<div class="pmc-map" data-layout="legal" aria-label="Règles, conditions et faits à l’horizontale ; conséquences vers le bas"><svg class="pmc-map-links" aria-hidden="true">${links.map((edge) => `<g data-from="${edge.from}" data-to="${edge.to}" data-relation="alimente"><path/></g>`).join('')}</svg>${displayed.map(card).join('')}</div>`;
}
