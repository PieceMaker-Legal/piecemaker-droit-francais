import type { Clause, Reasoning, Source, Step } from './graph.js';
import { conditionApplication } from './condition-application.js';

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const container = (step: Step) => step.answer && (step.value.startsWith('{') || step.name.includes('|'));
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const date = (text: string) => text.replace(/\|?(\d{4})-(\d{2})-(\d{2})\|?/g, (_, year, month, day) => `${Number(day) === 1 ? '1er' : Number(day)} ${MONTHS[Number(month) - 1]} ${year}`);
const number = (value: number, digits = 3) => value.toLocaleString('fr-FR', { maximumFractionDigits: digits });
const ratio = (text: string) => { const [a, b] = text.split('/').map(Number); return b ? a / b : a; };

const bare = (value: string) => value.trim().replace(/\s*\(\)$/, '');
export const structured = (value: string) => value.startsWith('{') || value.startsWith('[');

export const structured = (value: string) => /^(?:\[|(?:[\p{L}_][\p{L}\p{N}_]*\s*)?\{)/u.test(value);

export function display(step: Step) {
  const value = bare(step.value);
  if (structured(value)) {
    try {
      const qualification = JSON.parse(value)?.qualification;
      return typeof qualification === 'string' ? qualification : '';
    } catch { return ''; }
  }
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
  const value = structured(step.value) ? display(step) || step.value : bare(step.value);
  if (/^(?:Confirmé|Établi)$/i.test(value)) return 'ok';
  if (/^Réfuté$/i.test(value)) return 'ko';
  if (/^(?:Inconnu|Indéterminé|Disputé|Contesté|Non Tranchée|null|None|)$/i.test(value)) return 'warn';
  if (step.kind === 'rule' && /^Vrai$/i.test(value)) return 'ok';
  if (step.kind === 'rule' && /^Faux$/i.test(value)) return 'ko';
  return 'neutral';
}

export function formula(step: Step, human: (text: string) => string) {
  const definitions = step.origins.filter((origin) => origin.selected && origin.role === 'definition');
  if (structured(step.value)) return definitions.find((origin) => origin.overrides)?.comment || definitions[0]?.comment || '';
  const body = (definitions.find((origin) => !origin.overrides) ?? definitions[0])?.body ?? '';
  const text = body.replace(/\s+/g, ' ').match(/(?:^|\s)égal à\s+(.+)$/)?.[1]?.trim() ?? step.expression;
  const plain = text.replace(/^qualifier de\s*\((.*)\)$/, '$1').replace(/^qualifier de\s+/, '');
  if (!plain || structured(step.value) || structured(plain) || /\b(?:cumul|qualifier|selon|si|soit|existe|pour)\b/.test(plain)) return '';
  return date(plain).replace(/[\p{L}_][\p{L}\p{N}_]*/gu, (word) => /^(?:et|ou|non)$/.test(word) || /^(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|1er)$/.test(word) ? word : /_/.test(word) ? human(word) : word)
    .replace(/(\d+) jour\b/g, (_, n) => `${n} jour${n === '1' ? '' : 's'}`).replace(/(\d+) an\b/g, (_, n) => `${n} an${n === '1' ? '' : 's'}`).replace(/(\d+) mois\b/g, '$1 mois')
    .replace(/>=/g, '≥').replace(/<=/g, '≤').replace(/\s\*\s/g, ' × ').replace(/\s\/\s/g, ' ÷ ').replace(/\s=\s/g, ' = ');
}

export type Mode = 'litigation' | 'transactional';
type Words = { root: string; outcome: string; rule: string; exception: string; fact: string; yes: string; no: string; open: string; reserve: string; others: string; othersNote: string; overridden: string; unused: string; factOpen: string; lawMissing: string; facts: [string, string] };
export const WORDS: Record<Mode, Words> = {
  litigation: { root: 'Prétention', outcome: 'Conclusion', rule: 'Condition', exception: 'Exception', fact: 'Fait', yes: 'Prétention fondée', no: 'Prétention non fondée', open: 'Issue indéterminée', reserve: 'Sous réserve de', others: 'Autres résultats du programme', othersNote: 'Calculés dans ce scénario, ils ne fondent pas la prétention.', overridden: 'Principe écarté', unused: 'Exception non retenue', factOpen: 'Indéterminé', lawMissing: 'Fondement à préciser', facts: ['fait indéterminé', 'faits indéterminés'] },
  transactional: { root: 'Stipulation', outcome: 'Effet', rule: 'Condition de la clause', exception: 'Dérogation', fact: 'Hypothèse', yes: 'La stipulation joue', no: 'La stipulation ne joue pas', open: 'Effet indéterminé', reserve: 'À vérifier', others: 'Autres effets du contrat', othersNote: 'Calculés dans ce cas de figure, ils ne servent pas cette stipulation.', overridden: 'Clause écartée', unused: 'Dérogation non retenue', factOpen: 'Non renseignée', lawMissing: 'Clause à rattacher', facts: ['hypothèse non renseignée', 'hypothèses non renseignées'] },
};
export const modeOf = (model: Reasoning): Mode => model.mode === 'transactional' ? 'transactional' : 'litigation';
const GATES = { all: 'Conditions cumulatives', any: 'Conditions alternatives', not: 'Condition négative', leaf: 'Condition' };
const plural = (count: number, [one, many]: [string, string]) => `${count} ${count > 1 ? many : one}`;

export type Proof = { state: 'ok' | 'warn' | 'ko' | 'neutral'; text: string };
export function proofOf(step: Step, model: Reasoning): Proof | null {
  const mode = modeOf(model);
  if (step.kind === 'fact') {
    const pieces = step.sources.filter((source) => source.kind === 'piece');
    if (!pieces.length) return mode === 'transactional' ? null : { state: 'warn', text: 'Pièce à rattacher' };
    if (pieces.some((piece) => piece.status === 'failed')) return { state: 'ko', text: 'Citation introuvable dans la pièce' };
    if (pieces.some((piece) => piece.author === 'agent')) return { state: 'warn', text: 'Relevé par l’agent, à relire' };
    if (pieces.every((piece) => piece.author === 'human')) return { state: 'ok', text: 'Relu par l’avocat' };
    return { state: 'neutral', text: pieces.length > 1 ? `${pieces.length} pièces citées` : 'Pièce citée' };
  }
  if (step.kind === 'rule' && step.issue) return { state: 'warn', text: WORDS[mode].lawMissing };
  if (step.sources.some((source) => source.status === 'failed')) return { state: 'ko', text: 'Citation introuvable dans la source' };
  return null;
}

export function reasoningMap(model: Reasoning, human: (text: string) => string, sourceLink: (source: Source) => string, only?: Step[]) {
  if (!model.steps.length) return '';
  const mode = modeOf(model);
  const words = WORDS[mode];
  const steps = new Map(model.steps.map((step) => [step.id, step]));
  const rules = model.steps.filter((step) => step.kind === 'rule' && !container(step));
  const links: Array<{ from: string; to: string }> = [];
  const identity = (source: Source) => `${source.target}\n${source.quote}`;
  const author = (source: Source) => source.author === 'human' ? `<span class="pmc-author" data-author="human">Relu par l’avocat${source.review ? ` · ${escape(source.review)}` : ''}</span>` : source.author === 'agent' ? `<span class="pmc-author" data-author="agent">Relevé par l’agent${source.review ? ` · ${escape(source.review)}` : ''}, à relire</span>` : '';
  const documents = (sources: Source[], part: string) => sources.length ? `<ul class="pmc-docs" data-part="${part}">${sources.map((source) => `<li data-kind="${escape(source.kind)}">${sourceLink(source)}${source.quote ? `<q>${escape(source.quote)}</q>` : '<span class="pmc-warn">Citation exacte à indiquer</span>'}${sources.length > 1 ? author(source) : ''}${source.status === 'failed' ? '<span class="pmc-warn">Citation non retrouvée dans le document</span>' : ''}</li>`).join('')}</ul>` : '';
  const boolean = (step: Step) => /^(?:vrai|faux)$/i.test(bare(step.value));
  const truth = (step: Step): 'ok' | 'ko' | 'warn' => /^vrai$/i.test(bare(step.value)) ? 'ok' : /^faux$/i.test(bare(step.value)) ? 'ko' : tone(step) === 'warn' ? 'warn' : tone(step) === 'ko' ? 'ko' : 'ok';
  const seen = (step: Step, negated: boolean) => negated && boolean(step) ? { ok: 'ko', ko: 'ok', warn: 'warn' }[truth(step)]! : truth(step);
  const open = (step: Step) => truth(step) === 'warn';
  const valueLabel = (step: Step) => {
    if (step.kind === 'fact') return open(step) ? (/\b(?:Disputé|Contesté)\b/i.test(step.value) ? 'Contesté' : words.factOpen) : boolean(step) ? (truth(step) === 'ok' ? 'Oui' : 'Non') : '';
    return open(step) ? 'Indéterminée' : boolean(step) ? (truth(step) === 'ok' ? 'Remplie' : 'Non remplie') : '';
  };
  const status = (step: Step, current: string) => {
    if (!current) return '<span class="pmc-met" data-met="">Non, sans effet</span>';
    const label = valueLabel(step);
    const value = boolean(step) || open(step) || step.value.startsWith('{') || step.value.startsWith('[') ? '' : `<span class="pmc-value pmc-${current}">${escape(display(step))}</span>`;
    return `${value}${label ? `<span class="pmc-met pmc-${current}" data-met="${current}">${label}</span>` : ''}`;
  };
  const badge = (proof: Proof | null) => proof ? `<span class="pmc-proof" data-proof="${proof.state}">${escape(proof.text)}</span>` : '';
  const branch = (node: string, children: string[], current: string) => `<div class="pmc-branch" data-state="${current}">${node}${children.some(Boolean) ? `<div class="pmc-children">${children.join('')}</div>` : ''}</div>`;
  const order = (a: Step, b: Step) => Number(a.answer) - Number(b.answer) || a.level - b.level;
  const spine = rules.length ? [...rules].sort(order) : model.steps;
  const references = (clause: Clause, negated: boolean): Array<[Step, boolean]> => clause.kind !== 'leaf'
    ? clause.members.flatMap((member) => references(member, clause.kind === 'not' ? !negated : negated))
    : (steps.has(clause.ref) ? [clause.ref] : clause.refs).map((id) => steps.get(id)).filter((step): step is Step => Boolean(step)).map((step) => [step, negated]);
  const candidates = (only ?? spine).filter((step) => !container(step));
  const supports = (step: Step) => [...step.parents, ...(step.clause ? references(step.clause, false).map(([reference]) => reference.id) : [])].filter((id) => id !== step.id && steps.has(id));
  const dependencies = new Set(model.steps.filter((step) => !container(step)).flatMap(supports));
  const roots = candidates.filter((step) => !dependencies.has(step.id));
  const goal = roots.find((step) => step.answer) ?? roots.at(-1) ?? candidates.at(-1);
  const upstream = (step: Step) => {
    const found: Step[] = [];
    const seenIds = new Set([step.id]);
    const queue = supports(step);
    while (queue.length) {
      const id = queue.shift()!;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const entry = steps.get(id)!;
      if (['warn', 'ko'].includes(proofOf(entry, model)?.state ?? '') || open(entry)) found.push(entry);
      queue.push(...supports(entry));
    }
    return found;
  };
  const resultGroups = new Map<string, Step[]>();
  for (const step of only ? [] : roots) {
    if (step.clause || step.parents.length !== 1 || steps.get(step.parents[0])?.kind !== 'rule') continue;
    const parent = step.parents[0];
    resultGroups.set(parent, [...resultGroups.get(parent) ?? [], step]);
  }
  const sharedResults = new Map<string, Step[]>();
  const grouped = new Set<string>();
  for (const results of resultGroups.values()) {
    if (results.length < 2) continue;
    const primary = results.find((step) => step === goal) ?? results[0];
    const others = results.filter((step) => step !== primary);
    sharedResults.set(primary.id, others);
    others.forEach((step) => grouped.add(step.id));
  }
  const active = new Set<string>();
  const rendered = new Set<string>();
  const condition = (clause: Clause, owner: Step, negated: boolean): string => {
    const referenced = clause.kind === 'leaf' ? steps.get(clause.ref) : undefined;
    if (referenced) return node(referenced, owner, negated, true);
    const met = clause.met;
    const label = met === 'ok' ? 'Remplie' : met === 'ko' ? 'Non remplie' : met === 'warn' ? 'Indéterminée' : '';
    const text = clause.kind === 'leaf' ? `<p>${escape(date(human(clause.text)).replace(/>=/g, '≥').replace(/<=/g, '≤'))}</p>` : '';
    return branch(`<div class="pmc-gate" data-op="${clause.kind}" data-state="${met}"><span class="pmc-box-kind">${GATES[clause.kind]}</span>${text}${label ? `<span class="pmc-met pmc-${met}" data-met="${met}">${label}</span>` : ''}</div>`, references(clause, negated).map(([step, flipped]) => node(step, owner, flipped, true)), met);
  };
  const exceptions = (step: Step) => {
    const definitions = step.origins.filter((origin) => origin.role === 'definition');
    const applied = definitions.find((origin) => origin.selected);
    const describe = (origin: Step['origins'][number]) => {
      const legal = origin.sources.filter((source) => source.kind !== 'origin' && source.kind !== 'piece');
      const when = step.origins.filter((entry) => entry.role === 'condition' && entry.overrides === origin.key && entry.expression).map((entry) => date(human(entry.expression)));
      return `<p>${escape(origin.title || origin.label && human(origin.label) || origin.headings.at(-1) || 'Définition sans titre')}</p>${when.length ? `<p class="pmc-muted">Si ${escape(when.join(' ; '))}</p>` : ''}${legal.length ? `<div class="pmc-map-refs">${legal.map(sourceLink).join('')}</div>` : ''}`;
    };
    const principle = applied?.overrides ? definitions.find((origin) => origin.key === applied.overrides) : undefined;
    const unused = definitions.filter((origin) => !origin.selected && origin.overrides && origin !== principle);
    return `${principle ? `<div class="pmc-overridden" data-part="overridden"><span class="pmc-box-kind">${words.overridden}</span>${describe(principle)}</div>` : ''}${unused.map((origin) => `<div class="pmc-overridden" data-part="unused"><span class="pmc-box-kind">${words.unused}</span>${describe(origin)}</div>`).join('')}`;
  };
  const node = (step: Step, owner: Step | null, negated = false, parsed = false, expand = true): string => {
    if (container(step) || active.has(step.id)) return '';
    active.add(step.id);
    rendered.add(step.id);
    const current = owner && !parsed && boolean(step) && truth(step) === 'ko' && truth(owner) === 'ok' ? '' : seen(step, negated);
    if (owner) links.push({ from: step.id, to: owner.id });
    const isGoal = step === goal && !only;
    const application = owner ? conditionApplication(step, model) : null;
    const exception = application?.kind === 'exception' || step.origins.some((origin) => origin.selected && origin.role === 'definition' && origin.overrides);
    const stated = new Set((owner?.sources ?? []).map(identity));
    const foundation = step.kind === 'rule' ? step.sources.filter((source) => source.kind !== 'origin' && source.kind !== 'piece') : (application?.basis ?? []).filter((source) => !stated.has(identity(source)));
    const pieces = step.sources.filter((source) => source.kind === 'piece');
    const statement = [...new Set(pieces.map((piece) => piece.premise).filter((text): text is string => Boolean(text) && text !== step.title))];
    const written = step.kind === 'rule' && !step.clause && !isGoal ? formula(step, human) : '';
    const calculation = written && written.replace(/\s/g, '') !== display(step).replace(/\s/g, '') ? written : '';
    const top = step.clause?.kind === 'all' ? step.clause.members : step.clause ? [step.clause] : [];
    const explained = new Set(top.flatMap((member) => references(member, false).map(([reference]) => reference.id)));
    const children = expand ? [...top.map((member) => condition(member, step, false)), ...step.parents.filter((id) => !explained.has(id)).map((id) => node(steps.get(id)!, step))] : [];
    active.delete(step.id);
    const kind = isGoal ? words.root : exception ? words.exception : step.kind === 'fact' ? words.fact : words.rule;
    const missing = step.kind === 'rule' ? upstream(step) : [];
    const above = missing.length ? `<button type="button" class="pmc-text-action pmc-upstream" data-goto="${missing[0].id}">${missing.length} point${missing.length > 1 ? 's' : ''} ouvert${missing.length > 1 ? 's' : ''} en amont</button>` : '';
    const proof = proofOf(step, model);
    const card = `<article class="pmc-map-node" data-node="${step.id}" data-card="${step.id}" data-kind="${isGoal ? 'answer' : exception ? 'exception' : step.kind}" data-state="${isGoal ? 'neutral' : current}" tabindex="0" role="button" aria-pressed="false"><span class="pmc-box-kind">${kind}</span><h3>${escape(isGoal && model.objective || step.title)}</h3>${statement.map((text) => `<p class="pmc-statement">${escape(text)}</p>`).join('')}${isGoal ? '' : `<p class="pmc-result">${status(step, current)}${badge(proof)}</p>`}${calculation ? `<p class="pmc-calculation">${escape(calculation)}</p>` : ''}${documents(foundation, 'law')}${documents(pieces, 'evidence')}${exceptions(step)}${step.notes.justification ? `<p class="pmc-muted">${escape(step.notes.justification)}</p>` : ''}${step.notes.recherche ? `<p class="pmc-warn">À rechercher : ${escape(step.notes.recherche)}</p>` : ''}${isGoal ? badge(proof) : above}</article>`;
    const result = isGoal ? `<div class="pmc-root">${card}<span class="pmc-arrow" aria-hidden="true"></span>${outcome(step)}</div>` : card;
    const others = !owner && sharedResults.get(step.id);
    if (!others) return branch(result, children, isGoal ? truth(step) : current);
    const cards = others.map((entry) => {
      links.push({ from: step.parents[0], to: entry.id });
      return node(entry, null, false, false, false);
    });
    return branch(`<div class="pmc-root-results">${result}${cards.join('')}</div>`, children, isGoal ? truth(step) : current);
  };
  const outcome = (step: Step) => {
    const state = truth(step);
    const main = boolean(step) || open(step) ? { ok: words.yes, ko: words.no, warn: words.open }[state] : display(step);
    const all = [...new Set([step.id, ...upstream(step).map((entry) => entry.id)])].map((id) => steps.get(id)!);
    const groups: Array<[Step[], [string, string]]> = [
      [all.filter((entry) => entry.kind === 'fact' && open(entry)), words.facts],
      [all.filter((entry) => entry.kind === 'rule' && entry !== step && open(entry) && !upstream(entry).some(open)), ['condition indéterminée', 'conditions indéterminées']],
      [all.filter((entry) => proofOf(entry, model)?.text === 'Pièce à rattacher'), ['preuve manquante', 'preuves manquantes']],
      [all.filter((entry) => proofOf(entry, model)?.text === 'Relevé par l’agent, à relire'), ['pièce à relire', 'pièces à relire']],
      [all.filter((entry) => proofOf(entry, model)?.text === words.lawMissing), mode === 'transactional' ? ['clause à rattacher', 'clauses à rattacher'] : ['fondement à préciser', 'fondements à préciser']],
      [all.filter((entry) => proofOf(entry, model)?.state === 'ko'), ['citation introuvable', 'citations introuvables']],
    ];
    const reserves = groups.filter(([entries]) => entries.length).map(([entries, noun]) => `<li><button type="button" class="pmc-text-action" data-goto="${entries[0].id}">${plural(entries.length, noun)}</button></li>`);
    return `<article class="pmc-outcome" data-outcome="${step.id}" data-state="${state}"><span class="pmc-box-kind">${words.outcome}</span><h3>${escape(main)}</h3>${reserves.length ? `<p class="pmc-reserve">${words.reserve} :</p><ul class="pmc-reserves">${reserves.join('')}</ul>` : '<p class="pmc-reserve">Aucune réserve.</p>'}</article>`;
  };
  const wires = (body: string, label: string) => `<div class="pmc-map" data-layout="columns"${label ? ` aria-label="${label}"` : ''}><svg class="pmc-wires" aria-hidden="true"></svg>${body}</div>`;
  const main = goal ? node(goal, null) : '';
  const rest = [...roots.filter((step) => step !== goal && !grouped.has(step.id)).map((step) => node(step, null)), ...candidates.map((step) => rendered.has(step.id) ? '' : node(step, null))].join('');
  const hidden = links.map((edge) => `<i hidden data-from="${edge.from}" data-to="${edge.to}"></i>`).join('');
  if (only) return wires(`${hidden}${main}${rest}`, '');
  const unused = model.others.length ? `<details class="pmc-unused"><summary>${model.others.length} document${model.others.length > 1 ? 's' : ''} cité${model.others.length > 1 ? 's' : ''} à rattacher</summary>${documents(model.others, 'other')}</details>` : '';
  const legend = `<p class="pmc-map-legend"><span data-state="ok">Remplie</span><span data-state="warn">Indéterminée</span><span data-state="ko">Non remplie ou fait obstacle</span><span data-legend="proof">Étiquette : ${mode === 'transactional' ? 'clause' : 'preuve et fondement'}</span></p>`;
  const others = rest ? `<section class="pmc-others-map"><h4>${words.others}</h4><p class="pmc-muted">${words.othersNote}</p>${wires(rest, words.others)}</section>` : '';
  return `<div class="pmc-map-summary">${legend}</div>${unused}${wires(`${hidden}${main}`, `Graphe du raisonnement : ${words.root.toLowerCase()} à gauche, puis ses conditions vers la droite`)}${others}`;
}
