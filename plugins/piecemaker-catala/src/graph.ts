import { logicalText, sourceContext } from './source-context.js';

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function explanationGraph(dot: string, files: Array<{ nom: string; chemin: string; contenu?: string }> = []): string {
  const nodes = new Map<string, { lines: string[]; kind: string; value: string; source: string; context: string; documentation: string; target?: string; origin?: string }>();
  const inputBlock = dot.match(/subgraph\s+cluster_inputs\s*\{([^}]*)\}/)?.[1] ?? '';
  const inputs = new Set(inputBlock.match(/\bx\d+\b/g) ?? []);
  const plain = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? '';
  const attribute = (text: string, name: string) => plain(text.match(new RegExp(`\\b${name}\\s*=\\s*"((?:\\\\.|[^"\\\\])*)"`))?.[1] ?? '');
  const edges: Array<{ from: string; to: string; condition: boolean }> = [];
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
      if (!/style\s*=\s*"?invis\b/.test(attributes)) edges.push({ from: match[1], to: match[2], condition: /style\s*=\s*"?dashed\b/.test(attributes) });
    } else {
      const label = attributes.match(/\blabel\s*=\s*<([\s\S]*)>/)?.[1];
      if (!label) throw new Error('Libellé Catala absent.');
      const document = new DOMParser().parseFromString(label.replace(/<\/(?:td|tr)>|<br\s*\/?\s*>/gi, '\n'), 'text/html');
      const lines = (document.body.textContent || '').split('\n').map((line) => line.trim()).filter(Boolean);
      const condition = /style\s*=\s*"[^"]*dashed/.test(attributes);
      const kind = condition ? 'condition' : inputs.has(match[1]) ? 'input' : /shape\s*=\s*plaintext/.test(attributes) ? 'conclusion' : 'calculation';
      const source = attribute(attributes, 'URL');
      const documentation = sourceContext(source, files);
      nodes.set(match[1], { lines, kind, value: condition ? '' : lines.length > 1 ? lines.at(-1)!.replace(/^=\s*/, '') : '', source, context: attribute(attributes, 'tooltip'), documentation: documentation.text });
    }
  }
  if (!nodes.size || edges.some((edge) => !nodes.has(edge.from) || !nodes.has(edge.to))) throw new Error('Graphe Catala invalide.');
  let reference = 0;
  const cited = new Map<string, string>();
  for (const [id, node] of [...nodes]) {
    for (const entry of sourceContext(node.source, files).references) {
      const identity = JSON.stringify([entry.origin, entry.label, entry.target, node.documentation]);
      let key = cited.get(identity);
      if (!key) {
        key = `r${++reference}`;
        cited.set(identity, key);
        nodes.set(key, { lines: [entry.label, ...(entry.target ? [entry.target] : [])], kind: entry.kind, value: '', source: node.source, context: node.context, documentation: node.documentation, target: entry.target, origin: entry.origin });
      }
      edges.push({ from: key, to: id, condition: false });
    }
  }
  const levels = new Map<string, number>();
  for (let pass = 0; pass < nodes.size; pass++) {
    for (const id of nodes.keys()) {
      if (levels.has(id)) continue;
      const parents = edges.filter((edge) => edge.to === id).map((edge) => edge.from);
      if (parents.every((parent) => levels.has(parent))) levels.set(id, parents.length ? Math.max(...parents.map((parent) => levels.get(parent)!)) + 1 : 0);
    }
  }
  if (levels.size !== nodes.size) throw new Error('Le graphe Catala contient un cycle.');
  const ordered = [...nodes.keys()].sort((a, b) => levels.get(a)! - levels.get(b)!);
  const steps = new Map(ordered.filter((id) => ['calculation', 'conclusion'].includes(nodes.get(id)!.kind)).map((id, index) => [id, index + 1]));
  const stepFor = (id: string) => {
    if (steps.has(id)) return steps.get(id)!;
    const reachable = new Set([id]);
    for (let pass = 0; pass < nodes.size; pass++) for (const edge of edges) if (reachable.has(edge.from)) reachable.add(edge.to);
    return Math.min(...[...reachable].map((item) => steps.get(item) ?? Infinity));
  };
  const human = (value: string) => value.replace(/_/g, ' ').replace(/\btrue\b/g, 'Vrai').replace(/\bfalse\b/g, 'Faux');
  const wrap = (text: string) => text.match(/.{1,36}(?:\s|$)|.{1,36}/gu) ?? [''];
  const titles: Record<string, string> = { input: 'Donnée du scénario', condition: 'Condition appliquée', calculation: 'Règle · résultat', conclusion: 'Résultat du champ', piece: 'Pièce citée', article: 'Article · source citée', reference: 'Référence citée' };
  const positions = new Map<string, { x: number; y: number; height: number }>();
  const content = new Map([...nodes].map(([id, node]) => [id, {
    title: wrap(human(node.lines[0])),
    body: node.lines.slice(1).flatMap((line) => wrap(human(line))),
  }]));
  const height = (id: string) => 58 + (content.get(id)!.title.length + content.get(id)!.body.length) * 22 + (nodes.get(id)!.kind === 'condition' ? (nodes.get(id)!.lines.join(' ').match(/\b(?:et|ou|and|or)\b/g)?.length ?? 0) * 12 : 0);
  const place = (id: string, column: number, top: number) => {
    positions.set(id, { x: 24 + column * 340, y: top, height: height(id) });
    return top + height(id) + 22;
  };
  let y = 36;
  const spine = ordered.filter((id) => ['calculation', 'conclusion'].includes(nodes.get(id)!.kind));
  for (const id of spine) {
    let middle = y;
    let right = y;
    let citations = y;
    place(id, 0, y);
    const conditions = edges.filter((edge) => edge.to === id && nodes.get(edge.from)!.kind === 'condition');
    for (const edge of conditions) {
      if (!positions.has(edge.from)) middle = place(edge.from, 1, middle);
      for (const dependency of edges.filter((item) => item.to === edge.from)) {
        if (!positions.has(dependency.from) && nodes.get(dependency.from)!.kind === 'input') right = place(dependency.from, 2, right);
      }
    }
    for (const edge of edges.filter((item) => item.to === id)) {
      if (!positions.has(edge.from) && nodes.get(edge.from)!.kind === 'input') right = place(edge.from, 2, right);
    }
    for (const [key, node] of nodes) if (['piece', 'article', 'reference'].includes(node.kind) && stepFor(key) === steps.get(id)) citations = place(key, 3, citations);
    y = Math.max(y + height(id) + 22, middle, right, citations) + 28;
  }
  for (const id of ordered) {
    const node = nodes.get(id)!;
    if (!positions.has(id)) y = place(id, node.kind === 'conclusion' ? 0 : node.kind === 'condition' ? 1 : ['piece', 'article', 'reference'].includes(node.kind) ? 3 : 2, y);
  }
  const tone = (value: string) => /^(?:true|Vrai)$/i.test(value) ? 'ok' : /^(?:false|Faux)$/i.test(value) ? 'ko' : /^(?:Indéterminé|Disputé|null|None)$/i.test(value) ? 'warn' : 'neutral';
  const wires = edges.map((edge) => {
    const from = positions.get(edge.from)!;
    const to = positions.get(edge.to)!;
    const same = from.x === to.x;
    const forward = from.x < to.x;
    const x1 = from.x + (!same && forward ? 280 : 0), y1 = from.y + from.height / 2;
    const x2 = to.x + (!same && !forward ? 280 : 0), y2 = to.y + to.height / 2;
    const bend = forward && !same ? 35 : -35;
    const d = `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 + (same ? bend : -bend)} ${y2} ${x2} ${y2}`;
    return `<path class="pmc-wire" data-from="${edge.from}" data-to="${edge.to}" d="${d}" fill="none" stroke="currentColor" marker-end="url(#pmc-arrow)"${edge.condition ? ' stroke-dasharray="6 4"' : ''}/>`;
  }).join('');
  const boxes = ordered.map((id) => {
    const node = nodes.get(id)!;
    const position = positions.get(id)!;
    const lines = content.get(id)!;
    const state = tone(node.value);
    const missing = state === 'warn';
    const text = [...lines.title, ...lines.body];
    const step = stepFor(id);
    return `<g class="pmc-node" data-node="${id}" data-step="${Number.isFinite(step) ? step : ''}" data-kind="${node.kind}" data-tone="${state}" data-monetary="${/[$€£]/.test(node.lines.join(' '))}" data-title="${escape(human(node.lines[0]))}" data-value="${escape(node.value)}" data-expression="${escape(node.lines.join('\n'))}" data-literary-context="${escape(node.documentation)}" data-target="${escape(node.target ?? '')}" data-origin="${escape(node.origin ?? '')}" data-source="${escape(node.source)}" data-context="${escape(node.context)}" tabindex="0" role="button" aria-label="${escape(`${Number.isFinite(step) ? `Étape ${step} · ` : ''}${titles[node.kind]} : ${human(node.lines.join(' '))}`)}" aria-pressed="false"><title>${escape(node.context || human(node.lines.join(' ')))}</title><rect x="${position.x}" y="${position.y}" width="280" height="${position.height}" rx="14"${missing ? ' stroke-dasharray="5 4"' : ''}/><text class="pmc-node-kind" x="${position.x + 14}" y="${position.y + 22}">${Number.isFinite(step) ? `Étape ${step} · ` : ''}${titles[node.kind]}</text>${node.kind === 'condition' ? `<foreignObject x="${position.x + 14}" y="${position.y + 34}" width="252" height="${position.height - 40}"><div xmlns="http://www.w3.org/1999/xhtml" class="pmc-condition-expression">${logicalText(node.lines.join('\n'))}</div></foreignObject>` : `<text class="pmc-node-text" x="${position.x + 14}" y="${position.y + 46}">${text.map((line, index) => `<tspan x="${position.x + 14}" dy="${index ? 18 : 0}"${index >= lines.title.length ? ' class="pmc-node-value"' : ''}>${escape(line)}</tspan>`).join('')}</text>`}${missing ? `<text class="pmc-node-alert" x="${position.x + 258}" y="${position.y + 22}">?</text>` : ''}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" role="group" aria-label="Règles, conditions et données de l’exécution Catala" viewBox="0 0 ${reference ? 1360 : 1020} ${y}" width="${reference ? 1360 : 1020}" height="${y}"><defs><marker id="pmc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="var(--muted)"/></marker></defs>${wires}${boxes}</svg>`;
}
