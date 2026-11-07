import { logicalText, sourceContext } from './source-context.js';

type File = { nom: string; chemin: string; contenu?: string };
type Citation = { origin: string; target: string; quote: string; status: string };
export type Source = { label: string; target: string; kind: string; origin: string; quote: string; status: string };
export type Step = { id: string; kind: 'fact' | 'condition' | 'rule'; answer: boolean; name: string; title: string; formula: string; value: string; sources: Source[]; parents: string[]; level: number; issue: string };
export type Reasoning = { steps: Step[]; others: Source[] };

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const key = (name: string) => name.normalize('NFC').trim().toLowerCase().replace(/[\s_]+/g, '_');
export const human = (text: string) => text.replace(/[\p{L}\p{N}_]+/gu, (word) => /^(?:true|vrai)$/i.test(word) ? 'Vrai' : /^(?:false|faux)$/i.test(word) ? 'Faux' : word.replace(/_/g, ' ')).replace(/\s+/g, ' ').trim();
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const tone = (value: string) => value === 'Vrai' ? 'ok' : value === 'Faux' ? 'ko' : /^(?:Indéterminé|Disputé|null|None)$/i.test(value) ? 'warn' : 'neutral';
const KINDS = { fact: 'Fait', condition: 'Condition', rule: 'Règle' };

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
    const formula = kind === 'condition' ? '' : human(body.slice(1, equal >= 0 ? equal : body.length > 1 ? -1 : undefined).join(' '));
    steps.set(id, { id, kind, answer: node.kind === 'conclusion', name: kind === 'condition' ? '' : head, title: capital(human(head)), formula, value, sources: [], parents: edges.filter((edge) => edge.to === id).map((edge) => edge.from), level: 0, issue: '' });
  }
  for (const step of [...steps.values()].filter((entry) => entry.answer)) {
    const twin = step.parents.map((id) => steps.get(id)!).find((parent) => parent.kind === 'rule' && key(parent.name) === key(step.name));
    if (!twin) continue;
    twin.answer = true;
    steps.delete(step.id);
    for (const other of steps.values()) other.parents = other.parents.map((id) => id === step.id ? twin.id : id);
  }
  const used = new Set<string>();
  const identity = (source: Source) => JSON.stringify([source.origin, source.label, source.target, source.quote]);
  for (const step of steps.values()) {
    const own = [...(step.kind === 'rule' ? located(nodes.get(step.id)!.source) : []), ...(step.name ? linked.get(key(step.name)) ?? [] : [])];
    step.sources = own.filter((source, index) => own.findIndex((other) => identity(other) === identity(source)) === index);
    step.sources.forEach((source) => used.add(identity(source)));
    if (step.kind === 'fact' && step.value === 'Disputé') step.issue = 'Fait contesté : tranchez-le au vu des pièces.';
    if (step.kind === 'fact' && /^(?:Indéterminé|null|None)$/.test(step.value)) step.issue = 'Fait non établi : indiquez la pièce qui l’établit.';
    if (step.kind === 'rule' && !step.sources.some((source) => source.kind !== 'piece')) step.issue = 'Aucun article ni aucune décision rattaché à cette règle.';
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

const sourceLink = (source: Source) => `<a href="#" class="pmc-link" data-open-reference data-target="${escape(source.target)}" data-origin="${escape(source.origin)}" data-quote="${escape(source.quote)}">${escape(source.label)}</a>`;
const sourceItem = (source: Source) => `<li data-kind="${escape(source.kind)}">${sourceLink(source)}${source.quote ? `<q>${escape(source.quote)}</q>` : ''}${source.status === 'failed' ? '<span class="pmc-warn">Citation non retrouvée dans la source</span>' : ''}</li>`;
const sourceList = (sources: Source[]) => sources.length ? `<ul class="pmc-sources">${sources.map(sourceItem).join('')}</ul>` : '';
const value = (step: Step) => step.value ? `<span class="pmc-value pmc-${tone(step.value)}">${escape(step.value)}</span>` : '';

export function reasoningCard(step: Step, model: Reasoning) {
  const legal = step.sources.filter((source) => source.kind !== 'piece');
  const pieces = step.sources.filter((source) => source.kind === 'piece');
  const label = step.answer ? 'Réponse' : KINDS[step.kind];
  const parents = step.parents.map((id) => model.steps.find((entry) => entry.id === id)!);
  const application = parents.map((parent) => `<li data-tone="${tone(parent.value)}">${parent.kind === 'rule' ? `<a href="#" class="pmc-link" data-goto="${parent.id}">${escape(parent.title)}</a>` : `<span>${escape(parent.title)}</span>`}${value(parent)}${parent.kind === 'rule' ? '' : sourceList(parent.sources)}${parent.issue ? `<p class="pmc-warn">${escape(parent.issue)}</p>` : ''}</li>`).join('');
  return `<section class="pmc-rule" data-card="${step.id}" data-tone="${tone(step.value)}"><header><span class="pmc-kind">${label}</span><h3>${escape(step.title)}</h3>${value(step)}</header>${step.formula ? `<p class="pmc-formula">${logicalText(step.formula)}</p>` : ''}${legal.length ? `<h4>Fondement</h4>${sourceList(legal)}` : ''}${pieces.length ? `<h4>Pièces</h4>${sourceList(pieces)}` : ''}${step.issue ? `<p class="pmc-warn">${escape(step.issue)}</p>` : ''}${application ? `<h4>Application au dossier</h4><ul class="pmc-application">${application}</ul>` : ''}</section>`;
}

export function reasoningText(model: Reasoning) {
  const rules = model.steps.filter((step) => step.kind === 'rule').sort((a, b) => Number(b.answer) - Number(a.answer) || b.level - a.level);
  return `${rules.map((step) => reasoningCard(step, model)).join('')}${model.others.length ? `<section class="pmc-rule pmc-others"><header><h3>Autres sources citées</h3></header>${sourceList(model.others)}</section>` : ''}`;
}

export function reasoningIssues(model: Reasoning) {
  return [
    ...model.steps.filter((step) => step.issue).map((step) => ({ id: step.id, title: step.title, issue: step.issue })),
    ...[...model.steps.flatMap((step) => step.sources.map((source) => ({ id: step.id, source }))), ...model.others.map((source) => ({ id: '', source }))].filter((entry, index, all) => entry.source.status === 'failed' && all.findIndex((other) => other.source === entry.source) === index).map((entry) => ({ id: entry.id, title: entry.source.label, issue: 'Citation non retrouvée dans la source.' })),
  ];
}

export function reasoningGraph(model: Reasoning) {
  if (!model.steps.length) return '';
  const width = 290;
  const gap = 70;
  const lines = (text: string, size: number) => Math.max(1, Math.ceil(text.length / size));
  const height = (step: Step) => 46 + lines(step.title, 30) * 19 + (step.value ? 26 : 0) + step.sources.reduce((total, source) => total + lines(source.label, 38) * 17 + 4, 0);
  const positions = new Map<string, { x: number; y: number; height: number }>();
  const bottoms = new Map<number, number>();
  for (const step of model.steps) {
    const top = bottoms.get(step.level) ?? 20;
    positions.set(step.id, { x: 20 + step.level * (width + gap), y: top, height: height(step) });
    bottoms.set(step.level, top + height(step) + 16);
  }
  const total = { width: 40 + (Math.max(...model.steps.map((step) => step.level)) + 1) * (width + gap) - gap, height: Math.max(...bottoms.values()) + 4 };
  const wires = model.steps.flatMap((step) => step.parents.map((id) => {
    const from = positions.get(id)!;
    const to = positions.get(step.id)!;
    const x1 = from.x + width, y1 = from.y + 30, x2 = to.x, y2 = to.y + 30;
    return `<path class="pmc-wire" data-from="${id}" data-to="${step.id}" d="M${x1} ${y1} C${x1 + gap / 2} ${y1} ${x2 - gap / 2} ${y2} ${x2} ${y2}" fill="none" stroke="currentColor" marker-end="url(#pmc-arrow)"/>`;
  })).join('');
  const boxes = model.steps.map((step) => {
    const position = positions.get(step.id)!;
    return `<article class="pmc-node" data-node="${step.id}" data-kind="${step.answer ? 'answer' : step.kind}" data-tone="${tone(step.value)}"${step.issue ? ` data-issue="${escape(step.issue)}"` : ''} style="left:${position.x}px;top:${position.y}px;width:${width}px;min-height:${position.height}px" tabindex="0" role="button" aria-pressed="false" aria-label="${escape(`${step.answer ? 'Réponse' : KINDS[step.kind]} : ${step.title}${step.value ? `, ${step.value}` : ''}`)}"><span class="pmc-kind">${step.answer ? 'Réponse' : KINDS[step.kind]}</span><strong>${escape(step.title)}</strong>${value(step)}${step.sources.length ? `<ul class="pmc-node-sources">${step.sources.map((source) => `<li data-kind="${escape(source.kind)}">${sourceLink(source)}</li>`).join('')}</ul>` : ''}</article>`;
  }).join('');
  return `<div class="pmc-graph" data-width="${total.width}" style="width:${total.width}px;height:${total.height}px"><svg aria-hidden="true" width="${total.width}" height="${total.height}"><defs><marker id="pmc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="var(--muted)"/></marker></defs>${wires}</svg>${boxes}</div>`;
}
