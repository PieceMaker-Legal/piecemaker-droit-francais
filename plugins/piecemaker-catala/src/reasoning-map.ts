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
  const incomplete = new Set<string>();
  for (const step of model.steps) if (step.issue || step.notes.recherche || step.sources.some((source) => source.status === 'failed') || step.parents.some((id) => incomplete.has(id))) incomplete.add(step.id);
  const visited = new Set<string>();
  const links: Array<{ from: string; to: string }> = [];
  const warn = (text: string) => `<p class="pmc-warn">${escape(text)}</p>`;
  const docTitle = (step: Step) => step.origins.find((origin) => origin.selected && origin.role === 'definition' && origin.title)?.title ?? '';
  const named = (step: Step) => docTitle(step) || step.notes.question || step.title;
  const identity = (source: Source) => `${source.target}\n${source.quote}`;
  const documents = (sources: Source[], missing: string, part: string) => sources.length ? `<ul class="pmc-docs" data-part="${part}">${sources.map((source) => `<li data-kind="${escape(source.kind)}">${sourceLink(source)}${source.quote ? `<q>${escape(source.quote)}</q>` : '<span class="pmc-warn">Citation exacte à indiquer</span>'}${source.status === 'failed' ? '<span class="pmc-warn">Citation non retrouvée dans le document</span>' : ''}</li>`).join('')}</ul>` : missing ? warn(missing) : '';
  const boolean = (step: Step) => /^(?:vrai|faux)$/i.test(bare(step.value));
  const truth = (step: Step): 'ok' | 'ko' | 'warn' => /^vrai$/i.test(bare(step.value)) ? 'ok' : /^faux$/i.test(bare(step.value)) ? 'ko' : tone(step) === 'warn' ? 'warn' : tone(step) === 'ko' ? 'ko' : 'ok';
  const seen = (step: Step, negated: boolean) => negated && boolean(step) ? { ok: 'ko', ko: 'ok', warn: 'warn' }[truth(step)]! : truth(step);
  const state = (step: Step, negated: boolean) => seen(step, negated) === 'ok' && incomplete.has(step.id) ? 'warn' : seen(step, negated);
  const LABELS: Record<string, string[]> = { ok: ['Remplie', 'Écartée'], ko: ['Non remplie', 'Fait obstacle'], warn: ['À établir', 'À établir'] };
  const status = (step: Step, negated: boolean, current: string) => {
    if (!current) return '<span class="pmc-met" data-met="">Non, sans effet</span>';
    const unjustified = current !== seen(step, negated);
    const label = boolean(step) ? `${LABELS[seen(step, negated)][negated ? 1 : 0]}${unjustified ? ', à justifier' : ''}` : unjustified ? 'À justifier' : current === 'warn' ? 'À établir' : '';
    const value = boolean(step) || step.value.startsWith('{') || step.value.startsWith('[') ? '' : `<span class="pmc-value pmc-${current}">${escape(display(step))}</span>`;
    return `${value}${label ? `<span class="pmc-met pmc-${current}" data-met="${current}">${label}</span>` : ''}`;
  };
  const branch = (node: string, children: string[], current: string) => `<div class="pmc-branch" data-state="${current}">${node}${children.some(Boolean) ? `<div class="pmc-children">${children.join('')}</div>` : ''}</div>`;
  const GATES = { all: 'ET : toutes ces conditions sont requises', any: 'OU : une seule de ces conditions suffit', not: 'SAUF : cette condition ne doit pas être remplie' };
  const condition = (clause: Clause, owner: Step, negated: boolean): string => {
    if (clause.kind !== 'leaf') return branch(`<div class="pmc-gate" data-op="${clause.kind}">${GATES[clause.kind]}</div>`, clause.members.map((member) => condition(member, owner, clause.kind === 'not' ? !negated : negated)), '');
    const referenced = steps.get(clause.ref);
    if (referenced) return tree(referenced, owner, negated, true);
    return branch(`<div class="pmc-gate" data-op="leaf">${escape(human(clause.text).replace(/>=/g, '≥').replace(/<=/g, '≤'))}</div>`, clause.refs.map((id) => steps.get(id)).filter((step): step is Step => Boolean(step)).map((step) => tree(step, owner, negated, true)), '');
  };
  const tree = (step: Step, owner: Step | null, negated = false, parsed = false): string => {
    if (container(step)) return '';
    const current = owner && !parsed && boolean(step) && truth(step) === 'ko' && truth(owner) === 'ok' ? '' : state(step, negated);
    if (owner) links.push({ from: step.id, to: owner.id });
    if (visited.has(step.id)) return branch(`<div class="pmc-tree-ref" data-state="${current}"><button type="button" class="pmc-text-action" data-goto="${step.id}">${escape(named(step))}</button>${status(step, negated, current)}<span class="pmc-muted">Déjà détaillé dans le graphe</span></div>`, [], current);
    visited.add(step.id);
    const goal = !owner && visited.size === 1;
    const conclusion = step.answer || goal;
    const application = owner ? conditionApplication(step, model) : null;
    const exception = application?.kind === 'exception' || step.origins.some((origin) => origin.selected && origin.role === 'definition' && origin.overrides);
    const stated = new Set((owner?.sources ?? []).map(identity));
    const foundation = step.kind === 'rule' ? step.sources.filter((source) => source.kind !== 'origin' && source.kind !== 'piece') : (application?.basis ?? []).filter((source) => !stated.has(identity(source)));
    const pieces = step.sources.filter((source) => source.kind === 'piece');
    const evidence = step.kind === 'rule' ? documents(pieces, '', 'evidence') : documents(pieces, step.issue || 'Pièce à rattacher', 'evidence');
    const calculation = step.kind === 'rule' ? formula(step, human) : '';
    const top = step.clause && step.clause.kind === 'all' ? step.clause.members : step.clause ? [step.clause] : null;
    const children = top ? top.map((member) => condition(member, step, false)) : step.parents.map((id) => steps.get(id)).filter((parent): parent is Step => Boolean(parent)).map((parent) => tree(parent, step));
    const kind = goal ? 'Objectif' : conclusion ? 'Conclusion' : exception ? 'Exception' : step.kind === 'fact' ? 'Fait' : owner ? 'Condition' : 'Règle';
    return branch(`<article class="pmc-map-node" data-node="${step.id}" data-card="${step.id}" data-kind="${conclusion ? 'answer' : exception ? 'exception' : step.kind}" data-state="${current}" tabindex="0" role="button" aria-pressed="false"><span class="pmc-box-kind">${kind}</span><h3>${escape(goal && model.objective || named(step))}</h3><p class="pmc-result">${status(step, negated, current)}</p>${calculation ? `<p class="pmc-calculation">${escape(calculation)}</p>` : ''}${documents(foundation, step.kind === 'rule' ? 'Source de la règle à indiquer' : '', 'law')}${evidence}${step.notes.justification ? `<p class="pmc-muted">${escape(step.notes.justification)}</p>` : ''}${step.notes.recherche ? warn(`À rechercher : ${step.notes.recherche}`) : ''}</article>`, children, current);
  };
  const used = new Set(rules.flatMap((step) => step.parents));
  const roots = [...rules.filter((step) => step.answer), ...rules.filter((step) => !step.answer && !used.has(step.id)).sort((a, b) => b.level - a.level), ...(rules.length ? rules : model.steps)];
  const trees = roots.map((step) => visited.has(step.id) ? '' : tree(step, null)).join('');
  const unused = model.others.length ? `<details class="pmc-unused"><summary>${model.others.length} document${model.others.length > 1 ? 's' : ''} cité${model.others.length > 1 ? 's' : ''} à rattacher</summary>${documents(model.others, '', 'other')}</details>` : '';
  const legend = '<p class="pmc-map-legend"><span data-state="ok">Validé</span><span data-state="warn">À établir ou à justifier</span><span data-state="ko">Non rempli</span></p>';
  return `<div class="pmc-map-summary">L’objectif est à gauche. Chaque colonne à droite détaille ses conditions, jusqu’aux faits et aux pièces.<span>Cliquez sur une source pour l’ouvrir.</span>${legend}</div>${unused}<div class="pmc-map" data-layout="tree" aria-label="Arbre du raisonnement : objectif à gauche, conditions puis faits vers la droite"><svg class="pmc-wires" aria-hidden="true"></svg>${links.map((edge) => `<i hidden data-from="${edge.from}" data-to="${edge.to}"></i>`).join('')}${trees}</div>`;
}
