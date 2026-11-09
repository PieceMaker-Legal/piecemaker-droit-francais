import type { Reasoning, Source, Step } from './graph.js';

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const legal = (source: Source) => source.kind === 'article' || source.kind === 'jurisprudence';
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

type Name = (source: Source) => { main: string; note: string };
type Doc = { key: string; source: Source; quotes: string[]; steps: Set<string> };

const LEGAL_ID = /(?:LEGIARTI|JORFARTI|JURITEXT|CETATEXT|CONSTEXT)\d+|(?<=courdecassation\.fr\/decision\/)[0-9a-f]{24}/i;
const KIND_LABELS: Record<string, string> = { article: 'Article', jurisprudence: 'Jurisprudence', piece: 'Pièce' };

function docKey(source: Source, folder: string) {
  if (source.kind === 'origin' || /PROJECTION|\.catala_/i.test(source.target)) return '';
  if (/^https?:/i.test(source.target)) return legal(source) ? (source.id && LEGAL_ID.test(source.id) ? source.id : source.target.match(LEGAL_ID)?.[0] ?? '') : '';
  if (!source.target) return '';
  try {
    const path = decodeURIComponent(new URL(source.target, `file:///${source.origin.replace(/^\/+/, '')}`).pathname);
    return !folder || path.startsWith(`/${folder.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')}/`) ? path : '';
  } catch { return ''; }
}

function title(source: Source, name: Name) {
  const { main, note } = name(source);
  if (source.kind !== 'piece' || (source.label && source.label !== source.target && !/[\\/]/.test(source.label))) return { main: source.kind === 'piece' ? source.label || main : main, note };
  const text = main.replace(/\.[^.]+$/, '').replace(/^(\d+)[\s_-]+/, '').replace(/[_-]+/g, ' ').trim();
  const number = main.match(/^(\d+)[\s_-]/)?.[1];
  return { main: text ? text[0].toUpperCase() + text.slice(1) : main, note: number ? `Pièce ${Number(number)}` : '' };
}

export function reasoningMap(model: Reasoning, name: Name, folder = '') {
  const docs = new Map<string, Doc>();
  const missing = new Map<string, Source>();
  const own = new Map<string, string[]>();
  const add = (source: Source, step?: Step) => {
    const key = docKey(source, folder);
    if (!key) { if (source.kind !== 'origin' && !/PROJECTION|\.catala_/i.test(source.target)) missing.set(source.target || source.label, source); return ''; }
    const doc = docs.get(key) ?? { key, source, quotes: [], steps: new Set<string>() };
    if (source.quote && !doc.quotes.includes(source.quote)) doc.quotes.push(source.quote);
    if (step) doc.steps.add(step.title);
    docs.set(key, doc);
    return key;
  };
  for (const step of model.steps) own.set(step.id, [...new Set(step.sources.map((source) => add(source, step)).filter(Boolean))]);
  for (const source of model.others) add(source);
  if (!docs.size) return missing.size ? `<p class="pmc-warn">Aucune référence citée n’est enregistrée dans le dossier.</p>` : '';
  const steps = new Map(model.steps.map((step) => [step.id, step]));
  const isLegal = (key: string) => legal(docs.get(key)!.source);
  const top = (id: string) => { const keys = own.get(id) ?? []; const law = keys.filter(isLegal); return law.length ? law : keys; };
  const reach = new Map<string, string[]>();
  const effective = (id: string, seen = new Set<string>()): string[] => {
    if (reach.has(id)) return reach.get(id)!;
    if (seen.has(id)) return [];
    seen.add(id);
    const keys = top(id).length ? top(id) : [...new Set((steps.get(id)?.parents ?? []).flatMap((parent) => effective(parent, seen)))];
    reach.set(id, keys);
    return keys;
  };
  const edges = new Map<string, Set<string>>();
  const link = (from: string, to: string, why: string) => { if (from !== to) edges.set(`${from}\n${to}`, (edges.get(`${from}\n${to}`) ?? new Set()).add(why)); };
  for (const step of model.steps) {
    const targets = top(step.id);
    if (!targets.length) continue;
    for (const piece of (own.get(step.id) ?? []).filter((key) => !targets.includes(key))) for (const target of targets) link(piece, target, step.title);
    for (const parent of step.parents) for (const from of effective(parent)) for (const target of targets) link(from, target, step.title);
  }
  const pairs = [...edges.keys()].map((pair) => pair.split('\n') as [string, string]);
  const outgoing = (key: string) => pairs.filter(([from]) => from === key).map(([, to]) => to);
  const level = new Map<string, number>();
  const depth = (key: string, path = new Set<string>()): number => {
    if (level.has(key)) return level.get(key)!;
    if (path.has(key)) return 0;
    path.add(key);
    const value = Math.max(-1, ...outgoing(key).map((to) => depth(to, path))) + 1;
    path.delete(key);
    level.set(key, value);
    return value;
  };
  const linked = [...docs.keys()].filter((key) => pairs.some((pair) => pair.includes(key)));
  const loose = [...docs.keys()].filter((key) => !linked.includes(key));
  linked.forEach((key) => depth(key));
  const rows: string[][] = [];
  for (const key of linked) (rows[level.get(key)!] ??= []).push(key);
  const position = new Map<string, number>();
  rows.forEach((row) => {
    const weight = (key: string) => { const above = outgoing(key).filter((to) => position.has(to)); return above.length ? above.reduce((total, to) => total + position.get(to)!, 0) / above.length : .5; };
    row.sort((a, b) => weight(a) - weight(b));
    row.forEach((key, index) => position.set(key, (index + .5) / row.length));
  });
  const box = (key: string) => {
    const doc = docs.get(key)!;
    const { main, note } = title(doc.source, name);
    const kind = KIND_LABELS[doc.source.kind] ?? 'Document';
    const failed = doc.source.status === 'failed';
    const used = doc.steps.size ? `Fonde : ${[...doc.steps].join(' · ')}` : 'Cité sans lien dans le raisonnement';
    return `<button type="button" class="pmc-doc" data-doc="${escape(key)}" data-kind="${escape(doc.source.kind)}" data-open-reference data-target="${escape(doc.source.target)}" data-origin="${escape(doc.source.origin)}" data-quote="${escape(doc.quotes[0] ?? '')}"${doc.source.id ? ` data-id="${escape(doc.source.id)}"` : ''}${failed ? ' data-citation="failed"' : ''} title="${escape(used)}"><span class="pmc-doc-kind">${kind}${note ? ` · ${escape(note)}` : ''}</span><strong>${escape(main)}</strong>${failed ? '<span class="pmc-warn">Citation non retrouvée</span>' : ''}</button>`;
  };
  const arrows = pairs.map(([from, to]) => `<g data-from="${escape(from)}" data-to="${escape(to)}"><title>${escape([...edges.get(`${from}\n${to}`)!].join(' · '))}</title><path marker-end="url(#pmc-arrow)"/></g>`).join('');
  const graph = rows.length ? `<div class="pmc-graph"><svg class="pmc-graph-edges" aria-hidden="true"><defs><marker id="pmc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z"/></marker></defs>${arrows}</svg>${rows.map((row) => `<div class="pmc-graph-row">${row.map(box).join('')}</div>`).join('')}</div>` : '';
  const alone = loose.length ? `<section class="pmc-graph-loose"><h3>Cités sans lien dans le raisonnement</h3><div class="pmc-graph-row">${loose.map(box).join('')}</div></section>` : '';
  const absent = missing.size ? `<details class="pmc-unused"><summary>${missing.size} référence${missing.size > 1 ? 's' : ''} à enregistrer dans le dossier</summary><p>${[...missing.values()].map((source) => escape(name(source).main)).join(' · ')}</p></details>` : '';
  const legend = `<div class="pmc-map-summary">Une case par document cité. La flèche va du document qui établit un point vers le texte qu’il permet d’appliquer.<span><b data-kind="article">Article</b><b data-kind="jurisprudence">Jurisprudence</b><b data-kind="piece">Pièce</b> Cliquez sur une case pour ouvrir le document. Survolez-la pour voir les points qu’il fonde.</span></div>`;
  return `${legend}${absent}<div class="pmc-map" data-layout="graph" aria-label="Graphe des documents cités">${graph}${alone}</div>`;
}
