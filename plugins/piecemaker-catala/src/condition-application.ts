import type { Clause, Reasoning, Source, Step } from './graph.js';

const legal = (source: Source) => source.kind === 'article' || source.kind === 'jurisprudence';
const identity = (source: Source) => JSON.stringify([source.origin, source.target, source.quote]);
const unique = (sources: Source[]) => sources.filter((source, index) => sources.findIndex((other) => identity(other) === identity(source)) === index);
const references = (clause: Clause | null): string[] => !clause ? [] : clause.kind === 'leaf' ? clause.ref ? [clause.ref] : [] : clause.members.flatMap(references);
const nameKey = (name: string) => name.normalize('NFC').trim().toLocaleLowerCase('fr');
const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function conditionApplication(step: Step, model: Reasoning, predicate?: Clause) {
  const owners = model.steps.filter((owner) => {
    if (references(owner.clause).includes(step.id)) return true;
    if (owner.parents.includes(step.id) && (owner.conditional || !owner.clause && step.kind === 'rule' && /^(?:Vrai|Faux)$/.test(step.value))) return true;
    return owner.origins.some((origin) => origin.selected && origin.role === 'condition' && nameKey(origin.expression) === nameKey(step.name));
  });
  if (!predicate && (step.answer || !owners.length)) return null;
  const declared = new Set(step.origins.filter((origin) => origin.role === 'declaration').flatMap((origin) => origin.sources.map(identity)));
  const defined = step.origins.filter((origin) => origin.selected && origin.role !== 'declaration').flatMap((origin) => origin.sources);
  const inherited = owners.flatMap((owner) => owner.origins.filter((origin) => origin.selected && origin.role === 'condition' && nameKey(origin.expression) === nameKey(step.name)).flatMap((origin) => origin.sources));
  const basis = unique([...defined, ...inherited, ...step.sources.filter((source) => !declared.has(identity(source)))]).filter(legal);
  const facts = predicate || step.kind === 'rule' ? (predicate?.refs ?? step.parents).map((id) => model.steps.find((entry) => entry.id === id)).filter((entry): entry is Step => entry?.kind === 'fact') : [];
  const pieces = unique([...step.sources, ...facts.flatMap((fact) => fact.sources)].filter((source) => source.kind === 'piece'));
  const statements = facts.length ? facts.map((fact) => ({ text: fact.title, value: fact.value, quote: false })) : pieces.filter((piece) => piece.quote).map((piece) => ({ text: piece.quote, value: '', quote: true }));
  const exception = step.origins.some((origin) => origin.selected && origin.role === 'definition' && origin.overrides) || owners.some((owner) => {
    const definition = owner.origins.find((origin) => origin.selected && origin.role === 'definition' && origin.overrides);
    return definition && owner.origins.some((origin) => origin.role === 'condition' && origin.overrides === definition.key && nameKey(origin.expression) === nameKey(step.name));
  });
  return { kind: exception ? 'exception' : 'condition', title: step.notes.question || step.title, basis, pieces, facts: statements };
}

export function applicationMarkup(application: NonNullable<ReturnType<typeof conditionApplication>>, sourceLink: (source: Source) => string) {
  return `<div class="pmc-application"><section data-part="law"><h4>Fondement juridique</h4>${application.basis.length ? `<div class="pmc-map-refs">${application.basis.map((source) => `${sourceLink(source)}${source.quote ? `<q>${escape(source.quote)}</q>` : ''}`).join('')}</div>` : '<p class="pmc-warn">Fondement à préciser</p>'}</section><section data-part="facts"><h4>Fait invoqué</h4>${application.facts.length ? application.facts.map((fact) => fact.quote ? `<q>${escape(fact.text)}</q>` : `<p>${escape(fact.text)} <span class="pmc-scenario-value">Scénario : ${escape(fact.value)}</span></p>`).join('') : '<p class="pmc-warn">Aucun fait distinct renseigné</p>'}</section><section data-part="evidence"><h4>Pièce</h4>${application.pieces.length ? `<div class="pmc-map-refs">${application.pieces.map((source) => sourceLink(source)).join('')}</div>${application.pieces.some((piece) => piece.status === 'failed') ? '<p class="pmc-warn">Citation non retrouvée dans la source</p>' : ''}` : '<p class="pmc-warn">Pièce à rattacher</p>'}</section></div>`;
}
