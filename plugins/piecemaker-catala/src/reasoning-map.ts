import type { Reasoning, Source, Step } from './graph.js';

type Relation = '' | 'si' | 'selon' | 'sauf';

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const legal = (source: Source) => source.kind === 'article' || source.kind === 'jurisprudence';
const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s_]+/g, '_');
const words = (text: string) => new Set((text.match(/[\p{L}_][\p{L}\p{N}_]*/gu) ?? []).map(fold));
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

function relation(owner: Step, child: Step): Relation {
  const name = fold(child.name);
  if (owner.origins.some((origin) => origin.selected && origin.role === 'condition' && origin.overrides && words(origin.expression || origin.text).has(name))) return 'sauf';
  const text = definition(owner);
  const condition = text.match(/\bsi\s+([\s\S]+?)\s+alors\b/)?.[1];
  if (condition && words(condition).has(name)) return 'si';
  const subject = text.match(/\bselon\s+([\p{L}_][\p{L}\p{N}_]*)/u)?.[1];
  if (subject && fold(subject) === name) return 'selon';
  return '';
}

export function formula(step: Step, human: (text: string) => string) {
  const text = definition(step).replace(/\s+/g, ' ').match(/(?:^|\s)égal à\s+(.+)$/)?.[1]?.trim() ?? step.expression;
  const plain = text.replace(/^qualifier de\s*\((.*)\)$/, '$1').replace(/^qualifier de\s+/, '');
  if (!plain || /\b(?:cumul|qualifier|selon|si|soit|existe|pour)\b/.test(plain)) return '';
  return date(plain).replace(/[\p{L}_][\p{L}\p{N}_]*/gu, (word) => /^(?:et|ou|non)$/.test(word) || /^(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|1er)$/.test(word) ? word : /_/.test(word) ? human(word) : word)
    .replace(/(\d+) jour\b/g, (_, n) => `${n} jour${n === '1' ? '' : 's'}`).replace(/(\d+) an\b/g, (_, n) => `${n} an${n === '1' ? '' : 's'}`).replace(/(\d+) mois\b/g, '$1 mois')
    .replace(/>=/g, '≥').replace(/<=/g, '≤').replace(/\s\*\s/g, ' × ').replace(/\s\/\s/g, ' ÷ ').replace(/\s=\s/g, ' = ');
}

const KINDS: Record<string, [string, string]> = {
  conclusion: ['✓', 'Conclusion'],
  condition: ['◆', 'Condition'],
  calcul: ['∑', 'Calcul'],
  fait: ['●', 'Fait établi par pièce'],
  hypothese: ['◎', 'Hypothèse du scénario'],
};
const RELATIONS: Record<Exclude<Relation, ''>, string> = { si: 'Applicable si', selon: 'Selon', sauf: 'Sauf' };
const ORDER: Record<string, number> = { si: 0, selon: 1, condition: 2, calcul: 3, fait: 4, hypothese: 4, sauf: 5 };

export function reasoningMap(model: Reasoning, human: (text: string) => string, sourceLink: (source: Source, chip?: boolean) => string) {
  const shown = model.steps.filter((step) => !container(step));
  if (!shown.length) return '';
  const steps = new Map(shown.map((step) => [step.id, step]));
  const parents = (step: Step) => step.parents.map((id) => steps.get(id)).filter((parent): parent is Step => Boolean(parent));
  const used = new Set(shown.flatMap((step) => step.parents));
  const kind = (step: Step, root: boolean) => root && step.kind === 'rule' && !/^(?:argent|money|date|décimal|decimal|entier|integer|durée|duration)$/i.test(step.type) ? 'conclusion'
    : step.kind === 'rule' ? (/^(?:argent|money|date|décimal|decimal|entier|integer|durée|duration)$/i.test(step.type) || /^\$|^\|?\d{4}-|^-?\d/.test(step.value) ? 'calcul' : 'condition')
    : step.sources.some((source) => source.kind === 'piece') ? 'fait' : 'hypothese';
  const size = (step: Step, seen = new Set<string>()): number => seen.has(step.id) ? 0 : (seen.add(step.id), 1 + parents(step).reduce((total, parent) => total + size(parent, seen), 0));
  const outputs = model.steps.filter(container).flatMap((step) => step.parents).map((id) => steps.get(id)).filter((step): step is Step => Boolean(step));
  const roots = (outputs.length ? outputs : shown).filter((step) => !used.has(step.id) && step.kind === 'rule');
  const ordered = [...new Set(roots.length ? roots : shown.filter((step) => !used.has(step.id)))].sort((a, b) => Number(Boolean(b.notes.question)) - Number(Boolean(a.notes.question)) || size(b) - size(a));
  const rendered = new Set<string>();
  const pill = (step: Step) => `<span class="pmc-value pmc-${tone(step)}">${escape(display(step))}</span>`;
  const chips = (sources: Source[]) => sources.length ? `<div class="pmc-node-refs">${sources.map((source) => sourceLink(source, true)).join('')}</div>` : '';
  const node = (step: Step, root: boolean, link: Relation) => {
    const type = kind(step, root);
    const [icon, label] = link === 'sauf' ? ['⚖', 'Exception'] : KINDS[type];
    const pieces = step.sources.filter((source) => source.kind === 'piece' && !/PROJECTION|\.catala_/i.test(source.target));
    const law = step.sources.filter(legal);
    const others = step.sources.filter((source) => !legal(source) && source.kind !== 'piece' && source.kind !== 'origin');
    const quote = (type === 'fait' || type === 'hypothese' ? pieces : [...law, ...pieces]).find((source) => source.quote)?.quote ?? '';
    const expression = type === 'fait' || type === 'hypothese' ? '' : formula(step, human);
    const question = step.notes.question && step.notes.question !== step.title ? step.notes.question : '';
    const failed = step.sources.some((source) => source.status === 'failed');
    const open = type === 'hypothese' || tone(step) === 'warn';
    return `<article class="pmc-node" data-node="${step.id}" data-card="${step.id}" data-kind="${type}" data-tone="${tone(step)}" data-open="${open}" tabindex="0" role="button" aria-pressed="false"><header><span class="pmc-node-kind">${icon} ${label}</span>${pill(step)}</header><h3>${escape(question || step.title)}</h3>${question ? `<p class="pmc-node-name">${escape(step.title)}</p>` : ''}${expression ? `<p class="pmc-node-formula">${escape(expression)}</p>` : ''}${quote ? `<q>${escape(quote)}</q>` : ''}${chips([...law, ...others, ...pieces])}${step.notes.recherche ? `<p class="pmc-warn">À rechercher : ${escape(step.notes.recherche)}</p>` : type === 'hypothese' ? '<p class="pmc-warn">Pièce à produire pour établir ce point.</p>' : ''}${(type === 'condition' || type === 'conclusion') && !step.sources.length ? '<p class="pmc-warn">Aucune source rattachée à cette règle.</p>' : ''}${failed ? '<p class="pmc-warn">Citation non retrouvée dans la source.</p>' : ''}</article>`;
  };
  const branch = (step: Step, root: boolean, link: Relation): string => {
    const tag = link ? `<span class="pmc-relation" data-relation="${link}">${RELATIONS[link]}</span>` : '';
    if (rendered.has(step.id)) return `<li data-relation="${link}">${tag}<button type="button" class="pmc-node-ref" data-goto="${step.id}"><span>↑ ${escape(step.notes.question || step.title)}</span>${pill(step)}<span class="pmc-muted">voir plus haut</span></button></li>`;
    rendered.add(step.id);
    const children = parents(step).map((parent) => ({ parent, link: relation(step, parent) }))
      .sort((a, b) => (ORDER[a.link || kind(a.parent, false)] ?? 9) - (ORDER[b.link || kind(b.parent, false)] ?? 9));
    const cumulative = children.length > 1 && /\b(?:cumul|et)\b/.test(definition(step)) && !/\bselon\b/.test(definition(step));
    const list = children.length ? `<ul>${cumulative ? '<li class="pmc-tree-note">Toutes ces conditions doivent être réunies</li>' : ''}${children.map((child) => branch(child.parent, false, child.link)).join('')}</ul>` : '';
    return `<li data-relation="${link}">${tag}${node(step, root, link)}${list}</li>`;
  };
  const [main, ...rest] = ordered;
  const tree = main ? `<ul class="pmc-tree">${branch(main, true, '')}</ul>` : '';
  const others = rest.length ? `<section class="pmc-tree-others"><h3>Autres résultats calculés</h3><ul class="pmc-tree">${rest.map((step) => branch(step, false, '')).join('')}</ul></section>` : '';
  const unused = model.others.length ? `<details class="pmc-unused"><summary>${model.others.length} source${model.others.length > 1 ? 's' : ''} à rattacher</summary><div class="pmc-node-refs">${model.others.map((source) => sourceLink(source, true)).join('')}</div></details>` : '';
  const legend = `<div class="pmc-map-summary">Lecture de haut en bas : la conclusion, puis les conditions qui la commandent, jusqu’aux faits et aux pièces.<span><b data-kind="conclusion">✓ Conclusion</b><b data-kind="condition">◆ Condition</b><b data-kind="calcul">∑ Calcul</b><b data-kind="fait">● Fait établi par pièce</b><b data-kind="hypothese">◎ Hypothèse à établir</b><b data-kind="sauf">⚖ Sauf : exception</b></span><span><i class="pmc-value pmc-ok">Confirmé</i><i class="pmc-value pmc-ko">Réfuté</i><i class="pmc-value pmc-warn">Inconnu</i> Cliquez sur une case pour lire la règle, sa source et ses pièces.</span></div>`;
  return `${legend}${unused}<div class="pmc-map" data-layout="tree" aria-label="Arbre du raisonnement, de la conclusion vers les faits">${tree}${others}</div>`;
}
