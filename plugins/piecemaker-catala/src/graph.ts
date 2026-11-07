import { logicalText, sourceContext } from './source-context.js';

type File = { nom: string; chemin: string; contenu?: string };
type Citation = { origin: string; target: string; quote: string; status: string };
export type Source = { label: string; target: string; kind: string; origin: string; quote: string; status: string };
export type Clause = { kind: 'all' | 'any' | 'not' | 'leaf'; text: string; ref: string; refs: string[]; members: Clause[]; met: string };
export type Step = { id: string; kind: 'fact' | 'condition' | 'rule'; answer: boolean; name: string; title: string; formula: string; expression: string; value: string; sources: Source[]; parents: string[]; level: number; issue: string; clause: Clause | null };
export type Reasoning = { steps: Step[]; others: Source[] };

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const key = (name: string) => name.normalize('NFC').trim().toLowerCase().replace(/[\s_]+/g, '_');
export const human = (text: string) => text.replace(/[\p{L}\p{N}_]+/gu, (word) => /^(?:true|vrai)$/i.test(word) ? 'Vrai' : /^(?:false|faux)$/i.test(word) ? 'Faux' : word.replace(/_/g, ' ')).replace(/\s+/g, ' ').trim();
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const tone = (value: string) => value === 'Vrai' ? 'ok' : value === 'Faux' ? 'ko' : /^(?:Indéterminé|Disputé|null|None)$/i.test(value) ? 'warn' : 'neutral';
const legal = (source: Source) => source.kind !== 'piece';
const identity = (source: Source) => JSON.stringify([source.origin, source.label, source.target, source.quote]);
const unique = (sources: Source[]) => sources.filter((source, index) => sources.findIndex((other) => identity(other) === identity(source)) === index);
const OPERATORS = new Map([['et', 'et'], ['and', 'et'], ['ou', 'ou'], ['or', 'ou'], ['non', 'non'], ['not', 'non']]);
const BLOCKING = new Set(['si', 'alors', 'sinon', 'if', 'then', 'else', 'selon', 'soit', 'dans', 'pour', 'existe', 'bien', 'xor', 'match', 'with', 'let', 'in']);
function parseDot(dot: string) {
  const nodes = new Map<string, { lines: string[]; kind: string; source: string }>();
  const inputs = new Set(dot.match(/subgraph\s+cluster_inputs\s*\{([^}]*)\}/)?.[1].match(/\bx\d+\b/g) ?? []);
  const plain = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? '';
  const edges: Array<{ from: string; to: string }> = [];
  const statements = /\b(x\d+)\s*(?:->\s*(x\d+)\s*)?\[/g;
  let match: RegExpExecArray | null;
  while ((match = statements.exec(dot))) {
    const start = statements.lastIndex;
    let angle = 0;
    let quote = false;
    let end = start;
    for (; end < dot.length; end++) {
      const char = dot[end];
      if (char === '\\' && quote) { end++; continue; }
      if (char === '"') quote = !quote;
      if (quote) continue;
      if (char === '<') angle++;
      if (char === '>') angle--;
      if (char === ']' && angle === 0) break;
    }
    if (end === dot.length) throw new Error('Graphe Catala incomplet.');
    statements.lastIndex = end + 1;
    const attributes = dot.slice(start, end);
    if (match[2]) {
      if (!/style\s*=\s*"?invis\b/.test(attributes)) edges.push({ from: match[1], to: match[2] });
      continue;
    }
    const label = attributes.match(/\blabel\s*=\s*<([\s\S]*)>/)?.[1];
    if (!label) throw new Error('Libellé Catala absent.');
    const lines = (new DOMParser().parseFromString(label.replace(/<\/(?:td|tr)>|<br\s*\/?\s*>/gi, '\n'), 'text/html').body.textContent || '').split('\n').map((line) => line.trim()).filter(Boolean);
    const kind = /style\s*=\s*"[^"]*dashed/.test(attributes) ? 'condition' : inputs.has(match[1]) ? 'input' : /shape\s*=\s*plaintext/.test(attributes) ? 'conclusion' : 'calculation';
    nodes.set(match[1], { lines, kind, source: plain(attributes.match(/\bURL\s*=\s*"((?:\\.|[^"\\])*)"/)?.[1] ?? '') });
  }
  if (edges.some((edge) => !nodes.has(edge.from) || !nodes.has(edge.to))) throw new Error('Graphe Catala invalide.');
  return { nodes, edges };
}

function documentSources(file: File, citations: Citation[], linked: Map<string, Source[]>) {
  const blocks: Array<{ start: number; end: number; sources: Source[] }> = [];
  let pending: Source[] = [];
  let section: string[] = [];
  let fence = '';
  let start = 0;
  let catala = false;
  const flush = () => {
    const text = section.join('\n');
    section = [];
    if (!text.trim()) return;
    const concerned = [...text.matchAll(/^Concerne\s*:\s*(.+)$/gim)].flatMap((entry) => entry[1].split(',').map(key)).filter(Boolean);
    const found = sourceContext('https://catala.local/section.md', [{ nom: 'section.md', chemin: file.chemin, contenu: text }], true).references.filter((entry) => entry.target).map((entry) => ({ label: entry.label, target: entry.target, kind: entry.kind, origin: file.chemin, quote: entry.quote, status: citations.find((citation) => citation.origin === file.chemin && citation.target === entry.target && citation.quote === entry.quote)?.status ?? '' }));
    if (concerned.length) for (const name of concerned) linked.set(name, [...(linked.get(name) ?? []), ...found]);
    else pending.push(...found);
  };
  (file.contenu ?? '').split(/\r?\n/).forEach((line, index) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
        if (catala) { blocks.push({ start, end: index + 1, sources: pending }); pending = []; }
        fence = '';
      }
      return;
    }
    if (marker) { flush(); fence = marker[1]; start = index + 1; catala = marker[2].trim() === 'catala'; return; }
    if (/^#{1,6}\s/.test(line)) flush();
    section.push(line);
  });
  flush();
  return { blocks, trailing: pending };
}

const conjunction = (kind: 'all' | 'any', members: Clause[]): Clause => members.length === 1 ? members[0] : { kind, text: '', ref: '', refs: [], members: members.flatMap((member) => member.kind === kind ? member.members : [member]), met: '' };

function parseClause(expression: string, find: (name: string) => Step | undefined): Clause | null {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  if (!tokens.length || tokens.some((token) => BLOCKING.has(token))) return null;
  let at = 0;
  const leaf = (text: string): Clause => {
    const exact = find(text);
    const refs = exact ? [exact.id] : [...new Set((text.match(/[\p{L}_][\p{L}\p{N}_]*/gu) ?? []).map(find).filter((step): step is Step => Boolean(step)).map((step) => step.id))];
    return { kind: 'leaf', text, ref: exact?.id ?? '', refs, members: [], met: '' };
  };
  const unary = (): Clause => {
    if (OPERATORS.get(tokens[at]) === 'non') { at++; return { kind: 'not', text: '', ref: '', refs: [], members: [unary()], met: '' }; }
    if (tokens[at] === '(') {
      at++;
      const inner = any();
      if (tokens[at++] !== ')') throw new Error('parenthèse');
      return inner;
    }
    const words: string[] = [];
    while (at < tokens.length && !OPERATORS.has(tokens[at]) && tokens[at] !== '(' && tokens[at] !== ')') words.push(tokens[at++]);
    if (!words.length) throw new Error('terme');
    return leaf(words.join(' '));
  };
  const all = (): Clause => { const members = [unary()]; while (OPERATORS.get(tokens[at]) === 'et') { at++; members.push(unary()); } return conjunction('all', members); };
  const any = (): Clause => { const members = [all()]; while (OPERATORS.get(tokens[at]) === 'ou') { at++; members.push(all()); } return conjunction('any', members); };
  try {
    const root = any();
    return at === tokens.length && !(root.kind === 'leaf' && /^(?:vrai|faux|true|false)$/i.test(root.text)) ? root : null;
  } catch { return null; }
}

function judge(clause: Clause, steps: Map<string, Step>): string {
  const members = clause.members.map((member) => judge(member, steps));
  const truth = (value = '') => value === 'Vrai' ? 'ok' : value === 'Faux' ? 'ko' : value ? 'warn' : '';
  clause.met = clause.kind === 'leaf' ? truth(steps.get(clause.ref)?.value)
    : clause.kind === 'not' ? ({ ok: 'ko', ko: 'ok' } as Record<string, string>)[members[0]] ?? members[0]
    : members.includes(clause.kind === 'all' ? 'ko' : 'ok') ? (clause.kind === 'all' ? 'ko' : 'ok')
    : members.every((met) => met === (clause.kind === 'all' ? 'ok' : 'ko')) ? (clause.kind === 'all' ? 'ok' : 'ko')
    : members.includes('warn') ? 'warn' : '';
  return clause.met;
}

const leaves = (clause: Clause | null): Clause[] => !clause ? [] : clause.kind === 'leaf' ? [clause] : clause.members.flatMap(leaves);
const roots = (clause: Clause) => clause.kind === 'all' ? clause.members : [clause];
const inner = (clause: Clause) => clause.kind === 'not' ? clause.members[0] : clause;
const children = (clause: Clause) => inner(clause).kind === 'leaf' ? [] : inner(clause).members;
const lawOf = (clause: Clause, steps: Map<string, Step>) => unique(leaves(inner(clause).kind === 'leaf' ? inner(clause) : null).flatMap((leaf) => leaf.refs.flatMap((id) => steps.get(id)?.sources.filter(legal) ?? [])));

export function reasoning(dot: string, files: File[] = [], citations: Citation[] = []): Reasoning {
  const { nodes, edges } = parseDot(dot);
  const linked = new Map<string, Source[]>();
  const documents = new Map(files.map((file) => [file.nom.split('/').pop()!, documentSources(file, citations, linked)]));
  const located = (source: string) => {
    try {
      const url = new URL(source);
      const line = Number(url.hash.match(/^#L(\d+)/)?.[1]);
      return documents.get(decodeURIComponent(url.pathname).split('/').pop() ?? '')?.blocks.find((block) => block.start < line && line < block.end)?.sources ?? [];
    } catch { return []; }
  };
  const steps = new Map<string, Step>();
  for (const [id, node] of nodes) {
    const body = node.kind === 'conclusion' && node.lines.length > 2 ? node.lines.slice(1) : node.lines;
    let equal = -1;
    body.forEach((line, index) => { if (line.startsWith('=')) equal = index; });
    const value = human(equal >= 0 ? body.slice(equal).join(' ').replace(/^=\s*/, '') : node.kind !== 'condition' && body.length > 1 ? body.at(-1)! : '');
    const kind = node.kind === 'input' ? 'fact' : node.kind === 'condition' ? 'condition' : 'rule';
    const head = kind === 'condition' ? body.slice(0, equal >= 0 ? equal : undefined).join(' ') : body[0] ?? '';
    const expression = kind === 'condition' ? head : body.slice(1, equal >= 0 ? equal : body.length > 1 ? -1 : undefined).join(' ');
    steps.set(id, { id, kind, answer: node.kind === 'conclusion', name: kind === 'condition' ? '' : head, title: capital(human(head)), formula: kind === 'condition' ? '' : human(expression), expression, value, sources: [], parents: edges.filter((edge) => edge.to === id).map((edge) => edge.from), level: 0, issue: '', clause: null });
  }
  for (const step of [...steps.values()].filter((entry) => entry.answer)) {
    const twin = step.parents.map((id) => steps.get(id)!).find((parent) => parent.kind === 'rule' && key(parent.name) === key(step.name));
    if (!twin) continue;
    twin.answer = true;
    steps.delete(step.id);
    for (const other of steps.values()) other.parents = other.parents.map((id) => id === step.id ? twin.id : id);
  }
  const used = new Set<string>();
  for (const step of steps.values()) {
    step.sources = unique([...(step.kind === 'rule' ? located(nodes.get(step.id)!.source) : []), ...(step.name ? linked.get(key(step.name)) ?? [] : [])]);
    step.sources.forEach((source) => used.add(identity(source)));
  }
  const named = new Map([...steps.values()].filter((step) => step.name).map((step) => [key(step.name), step]));
  const find = (name: string) => named.get(key(name));
  for (const step of steps.values()) {
    if (step.kind !== 'rule') continue;
    const conditions = step.parents.map((id) => steps.get(id)!).filter((parent) => parent.kind === 'condition');
    const parts = [...conditions.map((condition) => parseClause(condition.expression, find) ?? { kind: 'leaf' as const, text: condition.expression, ref: condition.id, refs: condition.parents, members: [], met: '' }), parseClause(step.expression, find)].filter((part): part is Clause => Boolean(part));
    step.clause = parts.length ? conjunction('all', parts) : null;
    if (step.clause) judge(step.clause, steps);
    step.parents = [...new Set(step.parents.flatMap((id) => steps.get(id)!.kind === 'condition' ? steps.get(id)!.parents : [id]))];
  }
  for (const step of [...steps.values()]) if (step.kind === 'condition') steps.delete(step.id);
  for (const step of steps.values()) {
    step.parents = step.parents.filter((id) => steps.has(id));
    if (step.kind === 'fact' && step.value === 'Disputé') step.issue = 'Fait contesté : tranchez-le au vu des pièces.';
    if (step.kind === 'fact' && /^(?:Indéterminé|null|None)$/.test(step.value)) step.issue = 'Fait non établi : indiquez la pièce qui l’établit.';
    if (step.kind === 'rule' && !step.sources.some(legal) && !(step.clause && roots(step.clause).some((clause) => lawOf(clause, steps).length))) step.issue = 'Aucun article ni aucune décision rattaché à cette règle.';
  }
  const levels = new Map<string, number>();
  for (let pass = 0; pass <= steps.size; pass++) {
    for (const step of steps.values()) {
      if (levels.has(step.id) || !step.parents.every((id) => levels.has(id))) continue;
      levels.set(step.id, step.parents.length ? Math.max(...step.parents.map((id) => levels.get(id)!)) + 1 : 0);
    }
  }
  if (levels.size !== steps.size) throw new Error('Le graphe Catala contient un cycle.');
  for (const step of steps.values()) step.level = levels.get(step.id)!;
  const all = [...[...documents.values()].flatMap((document) => [...document.blocks.flatMap((block) => block.sources), ...document.trailing]), ...[...linked.values()].flat()];
  const others = all.filter((source, index) => !used.has(identity(source)) && all.findIndex((other) => identity(other) === identity(source)) === index);
  return { steps: [...steps.values()].sort((a, b) => a.level - b.level), others };
}

const FACT: Record<string, [string, string]> = { Vrai: ['ok', 'Établi'], Faux: ['ko', 'Non établi'], Disputé: ['warn', 'Contesté'] };
const pill = (kind: string, label: string) => `<span class="pmc-value pmc-${kind}">${escape(label)}</span>`;
const factPill = (step: Step) => pill(...(FACT[step.value] ?? (/^(?:Indéterminé|null|None|)$/.test(step.value) ? ['warn', 'À établir'] : ['neutral', step.value])) as [string, string]);
const clausePill = (clause: Clause) => {
  if (!clause.met) return '';
  const labels = clause.kind === 'not' ? { ok: 'Exception écartée', ko: 'Exception établie' } : { ok: 'Remplie', ko: 'Non remplie' };
  return pill(clause.met, (labels as Record<string, string>)[clause.met] ?? 'À établir');
};
const label = (clause: Clause) => {
  const core = inner(clause).kind === 'any' ? 'l’une des conditions' : inner(clause).kind === 'all' ? 'toutes les conditions' : '';
  return clause.kind === 'not' ? (core ? `Sauf si ${core}` : 'Sauf') : core ? capital(core) : 'Condition';
};
const sourceLink = (source: Source, chip = false) => `<a href="#" class="${chip ? 'pmc-chip' : 'pmc-link'}" data-kind="${escape(source.kind)}" data-open-reference data-target="${escape(source.target)}" data-origin="${escape(source.origin)}" data-quote="${escape(source.quote)}">${escape(source.label)}</a>`;
const sourceItem = (source: Source) => `<li data-kind="${escape(source.kind)}">${sourceLink(source)}${source.quote ? `<q>${escape(source.quote)}</q>` : ''}${source.status === 'failed' ? '<span class="pmc-warn">Citation non retrouvée dans la source</span>' : ''}</li>`;
const sourceList = (sources: Source[]) => sources.length ? `<ul class="pmc-sources">${sources.map(sourceItem).join('')}</ul>` : '';
const chips = (sources: Source[]) => sources.length ? `<span class="pmc-chips">${sources.map((source) => sourceLink(source, true)).join('')}</span>` : '';

function writer(model: Reasoning) {
  const steps = new Map(model.steps.map((step) => [step.id, step]));
  const named = (clause: Clause) => {
    const leaf = inner(clause);
    if (leaf.kind !== 'leaf') return '';
    return steps.get(leaf.ref)?.title || capital(human(leaf.text));
  };
  const title = (clause: Clause) => {
    const leaf = inner(clause);
    const rule = leaf.kind === 'leaf' ? steps.get(leaf.ref) : undefined;
    return rule?.kind === 'rule' ? `<a href="#" class="pmc-link" data-goto="${rule.id}">${escape(rule.title)}</a>` : `<strong>${escape(named(clause))}</strong>`;
  };
  const facts = (clause: Clause) => inner(clause).kind === 'leaf' ? inner(clause).refs.map((id) => steps.get(id)).filter((step): step is Step => step?.kind === 'fact') : [];
  const describe = (clause: Clause): string => clause.kind === 'leaf' ? `« ${named(clause)} »` : clause.kind === 'not' ? `sauf ${describe(clause.members[0])}` : `${clause.kind === 'any' ? 'l’une des conditions' : 'toutes les conditions'} (${clause.members.map(describe).join(', ')})`;
  const phrase = (clause: Clause, met: boolean) => clause.kind === 'not' ? `${met ? 'exception écartée' : 'exception établie'} : ${describe(clause.members[0])}` : clause.kind === 'any' && !met ? `aucune des conditions n’est remplie : ${clause.members.map(describe).join(', ')}` : `${met ? 'condition remplie' : 'condition non remplie'} : ${describe(clause)}`;
  const justify = (step: Step) => {
    const clause = step.clause;
    if (!clause) return '';
    if (clause.met === 'ok') return clause.kind === 'any' ? `${capital(phrase(clause.members.find((member) => member.met === 'ok')!, true))}.` : 'Toutes les conditions sont remplies.';
    if (clause.met === 'ko') return `${capital((clause.kind === 'any' ? [clause] : roots(clause).filter((member) => member.met === 'ko')).map((member) => phrase(member, false)).join(' ; '))}.`;
    const open = roots(clause).filter((member) => member.met !== 'ok');
    return open.length ? `Reste à établir : ${open.map(describe).join(', ')}.` : '';
  };
  const lawItem = (clause: Clause): string => {
    const nested = children(clause);
    return `<li data-clause="${clause.kind}"><span class="pmc-kind">${escape(label(clause))}</span>${nested.length ? '' : ` ${title(clause)}`}${chips(lawOf(clause, steps))}${nested.length ? `<ul>${nested.map(lawItem).join('')}</ul>` : ''}</li>`;
  };
  const factLine = (fact: Step) => `<li data-tone="${tone(fact.value)}"><span class="pmc-kind">Fait</span> <strong>${escape(fact.title)}</strong> ${factPill(fact)}${sourceList(fact.sources.filter((source) => !legal(source)))}${fact.issue ? `<p class="pmc-warn">${escape(fact.issue)}</p>` : ''}</li>`;
  const applied = (clause: Clause): string => {
    const nested = children(clause);
    const own = facts(clause);
    const rule = inner(clause).kind === 'leaf' ? steps.get(inner(clause).ref) : undefined;
    const head = nested.length ? `<span class="pmc-kind">${escape(label(clause))}</span>` : `<span class="pmc-kind">${escape(label(clause))}</span> ${title(clause)}${rule?.kind === 'rule' ? ` ${pill(tone(rule.value), rule.value)}` : ''}`;
    return `<li data-tone="${clause.met}">${head} ${clausePill(clause)}${own.length ? `<ul class="pmc-facts">${own.map(factLine).join('')}</ul>` : ''}${nested.length ? `<ul>${nested.map(applied).join('')}</ul>` : ''}</li>`;
  };
  const card = (step: Step) => {
    if (step.kind === 'fact') {
      const used = model.steps.filter((rule) => rule.parents.includes(step.id));
      return `<section class="pmc-rule" data-card="${step.id}" data-kind="fact" data-tone="${tone(step.value)}"><header><span class="pmc-kind">Fait du dossier</span><h3>${escape(step.title)}</h3>${factPill(step)}</header>${step.sources.some((source) => !legal(source)) ? `<h4>Pièces</h4>${sourceList(step.sources.filter((source) => !legal(source)))}` : '<p class="pmc-muted">Aucune pièce rattachée à ce fait.</p>'}${step.issue ? `<p class="pmc-warn">${escape(step.issue)}</p>` : ''}${used.length ? `<h4>Retenu pour</h4><ul class="pmc-sources">${used.map((rule) => `<li><a href="#" class="pmc-link" data-goto="${rule.id}">${escape(rule.title)}</a></li>`).join('')}</ul>` : ''}</section>`;
    }
    const basis = step.sources.filter(legal);
    const pieces = step.sources.filter((source) => !legal(source));
    const covered = new Set(leaves(step.clause).flatMap((leaf) => leaf.refs));
    const loose = step.parents.map((id) => steps.get(id)!).filter((parent) => !covered.has(parent.id));
    const law = step.clause ? `<p class="pmc-lead">${escape(step.title)} si :</p><ul class="pmc-law">${roots(step.clause).map(lawItem).join('')}</ul>` : step.formula ? `<p class="pmc-formula">${logicalText(step.formula)}</p>` : '';
    const application = [...(step.clause ? roots(step.clause).map(applied) : []), ...loose.map((parent) => parent.kind === 'fact' ? factLine(parent) : `<li><span class="pmc-kind">Règle</span> <a href="#" class="pmc-link" data-goto="${parent.id}">${escape(parent.title)}</a> ${pill(tone(parent.value), parent.value)}</li>`)].join('');
    return `<section class="pmc-rule" data-card="${step.id}" data-kind="${step.answer ? 'answer' : 'rule'}" data-tone="${tone(step.value)}"><header><span class="pmc-kind">${step.answer ? 'Question' : 'Règle'}</span><h3>${escape(step.title)}</h3></header><div class="pmc-part" data-part="law"><h4>Le droit</h4>${basis.length ? sourceList(basis) : ''}${law}</div>${application || pieces.length ? `<div class="pmc-part" data-part="facts"><h4>Les faits</h4>${application ? `<ul class="pmc-application">${application}</ul>` : ''}${pieces.length ? sourceList(pieces) : ''}</div>` : ''}<div class="pmc-part" data-part="result"><h4>Conclusion</h4><p class="pmc-result">${step.value ? pill(tone(step.value), step.value) : ''} ${escape(justify(step))}</p></div>${step.issue ? `<p class="pmc-warn">${escape(step.issue)}</p>` : ''}</section>`;
  };
  return { steps, card, named, facts };
}

export function reasoningCard(step: Step, model: Reasoning) {
  return writer(model).card(step);
}

const ordered = (model: Reasoning) => model.steps.filter((step) => step.kind === 'rule').sort((a, b) => Number(b.answer) - Number(a.answer) || b.level - a.level);

export function reasoningText(model: Reasoning) {
  const { card } = writer(model);
  return `${ordered(model).map(card).join('')}${model.others.length ? `<section class="pmc-rule pmc-others"><header><h3>Autres sources citées</h3></header>${sourceList(model.others)}</section>` : ''}`;
}

export function reasoningIssues(model: Reasoning) {
  return [
    ...model.steps.filter((step) => step.issue).map((step) => ({ id: step.id, title: step.title, issue: step.issue })),
    ...[...model.steps.flatMap((step) => step.sources.map((source) => ({ id: step.id, source }))), ...model.others.map((source) => ({ id: '', source }))].filter((entry, index, all) => entry.source.status === 'failed' && all.findIndex((other) => other.source === entry.source) === index).map((entry) => ({ id: entry.id, title: entry.source.label, issue: 'Citation non retrouvée dans la source.' })),
  ];
}

export function reasoningGraph(model: Reasoning) {
  const rules = ordered(model);
  if (!rules.length) return '';
  const { steps, named, facts } = writer(model);
  type Cell = { id: string; card: string; column: number; kind: string; tone: string; html: string; height: number; parent: string; dashed: boolean; issue: string; y: number };
  const cells: Cell[] = [];
  const WIDTH = 270;
  const GAP = 60;
  const lines = (text: string) => Math.max(1, Math.ceil(text.length * 7.4 / (WIDTH - 28)));
  const measure = (title: string, sources: Source[], pills: number) => 44 + (title ? lines(title) * 18 : 0) + pills * 26 + sources.reduce((total, source) => total + lines(source.label) * 18 + 4, 0);
  let count = 0;
  const add = (cell: Omit<Cell, 'y' | 'id'>, id = `n${count++}`) => { cells.push({ ...cell, id, y: 0 }); return id; };
  const used = new Set(model.steps.flatMap((step) => step.parents));
  const fact = (step: Step, column: number, parent: string) => {
    const pieces = step.sources.filter((source) => !legal(source));
    add({ card: step.id, column, kind: 'fact', tone: tone(step.value), parent, dashed: false, issue: step.issue, height: measure(step.title, pieces, 1), html: `<span class="pmc-kind">Fait</span><strong>${escape(step.title)}</strong>${factPill(step)}${chips(pieces)}` });
  };
  const expand = (rule: Step, column: number, id: string, path: Set<string>) => {
    if (path.has(rule.id)) return;
    const inside = new Set([...path, rule.id]);
    if (rule.clause) for (const entry of roots(rule.clause)) clause(entry, column + 1, id, inside);
    const covered = new Set(leaves(rule.clause).flatMap((leaf) => leaf.refs));
    for (const parent of rule.parents.map((ref) => steps.get(ref)!).filter((step) => !covered.has(step.id))) {
      if (parent.kind === 'fact') fact(parent, column + 1, id);
      else nested(parent, column + 1, id, 'Règle appliquée', inside, '', false);
    }
  };
  const nested = (rule: Step, column: number, parent: string, kind: string, path: Set<string>, met: string, dashed: boolean, entry?: Clause) => {
    const basis = rule.sources.filter(legal);
    const state = entry ? clausePill(entry) : '';
    const id = add({ card: rule.id, column, kind: dashed ? 'exception' : 'law', tone: met || tone(rule.value), parent, dashed, issue: rule.issue, height: measure(rule.title, basis, state ? 2 : 1), html: `<span class="pmc-kind">${escape(kind)}</span><a href="#" class="pmc-link" data-goto="${rule.id}">${escape(rule.title)}</a>${chips(basis)}${pill(tone(rule.value), rule.value)}${state}` });
    expand(rule, column, id, path);
  };
  const clause = (entry: Clause, column: number, parent: string, path: Set<string>) => {
    const members = children(entry);
    const target = steps.get(inner(entry).ref);
    if (!members.length && target?.kind === 'rule') { nested(target, column, parent, label(entry), path, entry.met, entry.kind === 'not', entry); return; }
    const law = lawOf(entry, steps);
    const id = add({ card: steps.get(parent)?.id ?? cells.find((cell) => cell.id === parent)!.card, column, kind: entry.kind === 'not' ? 'exception' : 'law', tone: entry.met, parent, dashed: entry.kind === 'not', issue: '', height: measure(members.length ? '' : named(entry), law, entry.met ? 1 : 0), html: `<span class="pmc-kind">${escape(label(entry))}</span>${members.length ? '' : `<strong>${escape(named(entry))}</strong>`}${chips(law)}${clausePill(entry)}` });
    for (const member of members) clause(member, column + 1, id, path);
    for (const step of facts(entry)) fact(step, column + 1, id);
    if (!members.length && !target) for (const ref of inner(entry).refs.map((item) => steps.get(item)!).filter((step) => step.kind === 'rule')) nested(ref, column + 1, id, 'Règle appliquée', path, '', false);
  };
  for (const rule of rules.filter((step) => step.answer || !used.has(step.id))) {
    const basis = rule.sources.filter(legal);
    add({ card: rule.id, column: 0, kind: rule.answer ? 'answer' : 'rule', tone: tone(rule.value), parent: '', dashed: false, issue: rule.issue, height: measure(rule.title, basis, rule.value ? 1 : 0), html: `<span class="pmc-kind">${rule.answer ? 'Question' : 'Règle'}</span><strong>${escape(rule.title)}</strong>${rule.value ? pill(tone(rule.value), rule.value) : ''}${chips(basis)}` }, rule.id);
    expand(rule, 0, rule.id, new Set());
  }
  const left = (column: number) => 20 + column * (WIDTH + GAP);
  const settle = (cell: Cell, y: number): number => {
    cell.y = y;
    let next = y;
    for (const child of cells.filter((item) => item.parent === cell.id)) next = settle(child, next) + 14;
    return Math.max(y + cell.height, next - 14);
  };
  let top = 52;
  for (const cell of cells.filter((item) => !item.parent)) top = settle(cell, top) + 44;
  const depth = Math.max(...cells.map((cell) => cell.column));
  const total = { width: left(depth) + WIDTH + 20, height: top };
  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  const wires = cells.filter((cell) => cell.parent).map((cell) => {
    const from = byId.get(cell.parent)!;
    const x1 = left(from.column) + WIDTH, y1 = from.y + 22, x2 = left(cell.column), y2 = cell.y + 22;
    const bend = Math.max((x2 - x1) / 2, 18);
    return `<path class="pmc-wire${cell.dashed ? ' is-sauf' : ''}" data-from="${from.id}" data-to="${cell.id}" d="M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}" fill="none" stroke="currentColor" marker-end="url(#pmc-arrow)"/>`;
  }).join('');
  const headers = Array.from({ length: depth + 1 }, (_, column) => `<span class="pmc-column" style="left:${left(column)}px;width:${WIDTH}px">${column ? `Niveau ${column}` : 'Question'}</span>`).join('');
  const boxes = cells.map((cell) => `<article class="pmc-node" data-node="${cell.id}" data-card="${cell.card}" data-kind="${cell.kind}" data-tone="${cell.tone}" data-level="${cell.column}"${cell.issue ? ` data-issue="${escape(cell.issue)}"` : ''} style="left:${left(cell.column)}px;top:${cell.y}px;width:${WIDTH}px;min-height:${cell.height}px" tabindex="0" role="button" aria-pressed="false">${cell.html}</article>`).join('');
  return `<div class="pmc-graph" data-width="${total.width}" style="width:${total.width}px;height:${total.height}px">${headers}<svg aria-hidden="true" width="${total.width}" height="${total.height}"><defs><marker id="pmc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="var(--muted)"/></marker></defs>${wires}</svg>${boxes}</div>`;
}
