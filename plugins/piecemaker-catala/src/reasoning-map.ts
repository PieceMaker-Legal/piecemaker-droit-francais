import type { Clause, Reasoning, Source, Step } from './graph.js';
import { conditionApplication } from './condition-application.js';

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const container = (step: Step) => step.answer && (step.value.startsWith('{') || step.name.includes('|'));
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const date = (text: string) => text.replace(/\|?(\d{4})-(\d{2})-(\d{2})\|?/g, (_, year, month, day) => `${Number(day) === 1 ? '1er' : Number(day)} ${MONTHS[Number(month) - 1]} ${year}`);
const number = (value: number, digits = 3) => value.toLocaleString('fr-FR', { maximumFractionDigits: digits });
const ratio = (text: string) => { const [a, b] = text.split('/').map(Number); return b ? a / b : a; };

const bare = (value: string) => value.trim().replace(/\s*\(\)$/, '');

export function display(step: Step) {
  const value = bare(step.value);
  const type = step.type.toLowerCase();
  if (/^vrai$/i.test(value)) return 'Oui';
  if (/^faux$/i.test(value)) return 'Non';
  if (type === 'argent' || type === 'money' || /^\$[\d,]+(?:\.\d+)?$/.test(value)) {
    const amount = Number(value.replace(/[$,\s€]/g, ''));
    return Number.isFinite(amount) ? `${number(amount, 2)} €` : value;
  }
  if (type === 'date' || /^\|?\d{4}-\d{2}-\d{2}\|?$/.test(value)) return date(value);
  if ((type === 'décimal' || type === 'decimal' || type === 'entier' || type === 'integer') && /^-?[\d.]+(?:\/[\d.]+)?$/.test(value)) return number(ratio(value));
  return value || 'Indéterminé';
}

export function tone(step: Step) {
  const value = bare(step.value);
  if (/^(?:Confirmé|Établi)$/i.test(value)) return 'ok';
  if (/^Réfuté$/i.test(value)) return 'ko';
  if (/^(?:Inconnu|Indéterminé|Disputé|Contesté|Non Tranchée|null|None|)$/i.test(value)) return 'warn';
  if (step.kind === 'rule' && /^Vrai$/i.test(value)) return 'ok';
  if (step.kind === 'rule' && /^Faux$/i.test(value)) return 'ko';
  return 'neutral';
}

const definition = (step: Step) => step.origins.find((origin) => origin.selected && origin.role === 'definition' && !origin.overrides)?.body
  ?? step.origins.find((origin) => origin.selected && origin.role === 'definition')?.body ?? '';

export function formula(step: Step, human: (text: string) => string) {
  const text = definition(step).replace(/\s+/g, ' ').match(/(?:^|\s)égal à\s+(.+)$/)?.[1]?.trim() ?? step.expression;
  const plain = text.replace(/^qualifier de\s*\((.*)\)$/, '$1').replace(/^qualifier de\s+/, '');
  if (!plain || /\b(?:cumul|qualifier|selon|si|soit|existe|pour)\b/.test(plain)) return '';
  return date(plain).replace(/[\p{L}_][\p{L}\p{N}_]*/gu, (word) => /^(?:et|ou|non)$/.test(word) || /^(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|1er)$/.test(word) ? word : /_/.test(word) ? human(word) : word)
    .replace(/(\d+) jour\b/g, (_, n) => `${n} jour${n === '1' ? '' : 's'}`).replace(/(\d+) an\b/g, (_, n) => `${n} an${n === '1' ? '' : 's'}`).replace(/(\d+) mois\b/g, '$1 mois')
    .replace(/>=/g, '≥').replace(/<=/g, '≤').replace(/\s\*\s/g, ' × ').replace(/\s\/\s/g, ' ÷ ').replace(/\s=\s/g, ' = ');
}

export function reasoningMap(model: Reasoning, human: (text: string) => string, sourceLink: (source: Source) => string) {
  if (!model.steps.length) return '';
  const steps = new Map(model.steps.map((step) => [step.id, step]));
  const rules = model.steps.filter((step) => step.kind === 'rule' && !container(step));
  const displayed: Step[] = [];
  const visited = new Set<string>();
  const visit = (step: Step) => {
    if (visited.has(step.id) || container(step)) return;
    visited.add(step.id);
    for (const id of step.parents) { const parent = steps.get(id); if (parent?.kind === 'rule') visit(parent); }
    displayed.push(step);
  };
  const used = new Set(rules.flatMap((step) => step.parents));
  rules.filter((step) => step.answer || !used.has(step.id)).forEach(visit);
  (rules.length ? rules : model.steps).forEach(visit);
  const incomplete = new Set<string>();
  for (const step of model.steps) if (step.issue || step.notes.recherche || step.sources.some((source) => source.status === 'failed') || step.parents.some((id) => incomplete.has(id))) incomplete.add(step.id);
  const usedBy = (id: string, owner: string) => `${owner}-uses-${id}`;
  const links = displayed.flatMap((step) => step.parents.filter((id) => visited.has(id) && steps.get(id)?.kind === 'rule').map((id) => ({ from: id, to: step.id })));
  const warn = (text: string) => `<p class="pmc-warn">${escape(text)}</p>`;
  const docTitle = (step: Step) => step.origins.find((origin) => origin.selected && origin.role === 'definition' && origin.title)?.title ?? '';
  const named = (step: Step) => docTitle(step) || step.notes.question || step.title;
  const identity = (source: Source) => `${source.target}\n${source.quote}`;
  const documents = (sources: Source[], missing: string) => sources.length ? `<ul class="pmc-docs">${sources.map((source) => `<li data-kind="${escape(source.kind)}">${sourceLink(source)}${source.quote ? `<q>${escape(source.quote)}</q>` : '<span class="pmc-warn">Citation exacte à indiquer</span>'}${source.status === 'failed' ? '<span class="pmc-warn">Citation non retrouvée dans le document</span>' : ''}</li>`).join('')}</ul>` : missing ? warn(missing) : '';
  const value = (step: Step) => (step.value.startsWith('{') || step.value.startsWith('[')) ? '' : `<span class="pmc-value pmc-${tone(step)}">${escape(display(step))}</span>`;
  const met = (step: Step) => /^vrai$/i.test(bare(step.value)) ? 'ok' : /^faux$/i.test(bare(step.value)) ? 'ko' : tone(step) === 'warn' ? 'warn' : '';
  const status = (state: string, negated: boolean) => {
    const label = negated ? { ok: ['ko', 'Fait obstacle'], ko: ['ok', 'Écartée'], warn: ['warn', 'À établir'] }[state] : { ok: ['ok', 'Remplie'], ko: ['ko', 'Non remplie'], warn: ['warn', 'À établir'] }[state];
    return label ? `<span class="pmc-met pmc-${label[0]}" data-met="${label[0]}">${label[1]}</span>` : '';
  };
  const support = (step: Step, titled: boolean): string => {
    const name = titled ? `<button type="button" class="pmc-text-action" data-goto="${step.id}">${escape(named(step))}</button> ` : '';
    if (step.kind === 'rule') return `<div class="pmc-fact"><p>${name}${value(step)} <button type="button" class="pmc-text-action pmc-prior-result" data-goto="${step.id}">${titled ? 'Voir la règle' : 'Résultat de la règle ci-dessus'}</button></p></div>`;
    const pieces = step.sources.filter((source) => source.kind === 'piece');
    return `<div class="pmc-fact"><p>${name}${value(step)}</p><div data-part="evidence">${documents(pieces, step.issue || 'Pièce à rattacher')}</div></div>`;
  };
  const row = (relation: string, state: string, title: string, law: string, facts: string, owner: Step, id = '') =>
    `<li class="pmc-condition-row" data-condition="${id}" data-relation="${relation}"${id ? ` data-flow-anchor="${usedBy(id, owner.id)}"` : ''}><div data-part="condition">${relation === 'sauf' ? '<span class="pmc-box-kind">Exception</span>' : ''}<h4>${id ? `<button type="button" class="pmc-text-action" data-goto="${id}">${escape(title)}</button>` : escape(title)}</h4> ${state}${law}</div><div data-part="facts">${facts}</div></li>`;
  const GROUPS = { all: 'Toutes ces conditions sont requises', any: 'Une seule de ces conditions suffit', not: 'Cette condition ne doit pas être remplie' };
  const condition = (clause: Clause, owner: Step, negated = false): string => {
    if (clause.kind !== 'leaf') return `<li class="pmc-condition-group" data-op="${clause.kind}"><p>${GROUPS[clause.kind]}</p><ul>${clause.members.map((member) => condition(member, owner, clause.kind === 'not' ? !negated : negated)).join('')}</ul></li>`;
    const referenced = steps.get(clause.ref);
    const supporting = (referenced ? [referenced] : clause.refs.map((id) => steps.get(id))).filter((step): step is Step => Boolean(step));
    const application = referenced ? conditionApplication(referenced, model) : null;
    const stated = new Set(owner.sources.map(identity));
    const own = referenced?.kind === 'rule' ? [] : (application?.basis ?? []).filter((source) => !stated.has(identity(source)));
    return row(application?.kind === 'exception' ? 'sauf' : 'si', status(referenced ? met(referenced) : '', negated), referenced ? named(referenced) : human(clause.text), documents(own, ''), supporting.length ? supporting.map((step) => support(step, !referenced)).join('') : warn('Fait à rattacher'), owner, referenced?.id ?? '');
  };
  const card = (step: Step) => {
    const exception = step.origins.some((origin) => origin.selected && origin.role === 'definition' && origin.overrides);
    const foundation = step.sources.filter((source) => source.kind !== 'origin');
    const top = step.clause && step.clause.kind !== 'leaf' && step.clause.kind !== 'not' ? step.clause : null;
    const rows = step.kind === 'fact' ? row('si', '', named(step), '', support(step, false), step, step.id)
      : top ? top.members.map((member) => condition(member, step)).join('')
      : step.clause ? condition(step.clause, step)
      : step.parents.map((id) => condition({ kind: 'leaf', text: '', ref: id, refs: [id], members: [], met: '' }, step)).join('');
    const calculation = step.kind === 'rule' ? formula(step, human) : '';
    const open = Boolean(step.notes.recherche || !foundation.length || incomplete.has(step.id));
    const heading = step.kind === 'fact' ? 'Donnée' : exception ? 'Exception' : 'Règle';
    const outcome = docTitle(step) || step.title;
    const table = rows ? `<section class="pmc-application-table"><div class="pmc-columns"><span>${step.kind === 'fact' ? 'Donnée' : top?.kind === 'any' ? 'Conditions : une seule suffit' : 'Conditions'}</span><span>Faits et pièces</span></div><ul class="pmc-conditions">${rows}</ul></section>` : '';
    return `<article class="pmc-map-node pmc-inference" data-node="${step.id}" data-card="${step.id}" data-kind="${step.answer ? 'answer' : exception ? 'exception' : step.kind}" data-open="${open}" tabindex="0" role="button" aria-pressed="false"><section class="pmc-major" data-part="law"><span class="pmc-box-kind">${heading}</span><h3>${escape(named(step))}</h3>${documents(foundation, step.kind === 'fact' ? '' : 'Source de la règle à indiquer')}${step.notes.justification ? `<p class="pmc-muted">${escape(step.notes.justification)}</p>` : ''}${step.notes.recherche ? warn(`À rechercher : ${step.notes.recherche}`) : ''}</section>${table}<div class="pmc-consequence" data-part="consequence" data-flow-anchor="${step.id}-outcome"><span class="pmc-box-kind">${step.answer ? 'Conclusion' : 'Conséquence'}</span>${outcome === named(step) ? '' : `<strong>${escape(outcome)}</strong>`}${value(step)}${calculation ? `<span class="pmc-calculation">${escape(calculation)}</span>` : ''}</div></article>`;
  };
  const objective = `<section class="pmc-objective" data-part="objective"><span>Objectif déclaré</span>${model.objective ? `<strong>${escape(model.objective)}</strong>` : warn('Objectif à déclarer : ajoutez une ligne « Objectif : … » dans le programme.')}</section>`;
  const unused = model.others.length ? `<details class="pmc-unused"><summary>${model.others.length} document${model.others.length > 1 ? 's' : ''} cité${model.others.length > 1 ? 's' : ''} à rattacher</summary>${documents(model.others, '')}</details>` : '';
  const cards = displayed.map(card).join('');
  return `${objective}<div class="pmc-map-summary">Chaque bloc : une règle, ses conditions, les faits qui les établissent, puis sa conséquence.<span>Une flèche relie une conséquence à la condition qu’elle remplit. Cliquez sur une source pour l’ouvrir.</span></div>${unused}<div class="pmc-map" data-layout="legal" aria-label="Une règle par bloc : conditions, faits et pièces, conséquence"><svg class="pmc-map-links" aria-hidden="true"><defs><marker id="pmc-flow-head" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><polygon points="0,0 8,4 0,8"/></marker></defs>${links.map((edge) => `<g data-from="${edge.from}" data-to="${edge.to}" data-relation="alimente" data-anchor-from="${edge.from}-outcome" data-anchor-to="${usedBy(edge.from, edge.to)}"><path marker-end="url(#pmc-flow-head)"/></g>`).join('')}</svg>${cards}</div>`;
}
