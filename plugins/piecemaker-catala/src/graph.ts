const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function explanationGraph(dot: string): string {
  const nodes = new Map<string, string[]>();
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
      nodes.set(match[1], lines.flatMap((line) => line.match(/.{1,48}(?:\s|$)|.{1,48}/gu) ?? [line]));
    }
  }
  if (!nodes.size || edges.some((edge) => !nodes.has(edge.from) || !nodes.has(edge.to))) throw new Error('Graphe Catala invalide.');
  const levels = new Map<string, number>();
  for (let pass = 0; pass < nodes.size; pass++) {
    for (const id of nodes.keys()) {
      if (levels.has(id)) continue;
      const parents = edges.filter((edge) => edge.to === id).map((edge) => edge.from);
      if (parents.every((parent) => levels.has(parent))) levels.set(id, parents.length ? Math.max(...parents.map((parent) => levels.get(parent)!)) + 1 : 0);
    }
  }
  if (levels.size !== nodes.size) throw new Error('Le graphe Catala contient un cycle.');
  const ranks = Array.from({ length: Math.max(...levels.values()) + 1 }, (_, rank) => [...nodes.keys()].filter((id) => levels.get(id) === rank));
  const width = Math.max(...ranks.map((rank) => rank.length)) * 320;
  const positions = new Map<string, { x: number; y: number; height: number }>();
  let y = 20;
  for (const rank of ranks) {
    const height = Math.max(...rank.map((id) => nodes.get(id)!.length * 20 + 24));
    rank.forEach((id, index) => positions.set(id, { x: (width - rank.length * 320) / 2 + index * 320 + 10, y, height }));
    y += height + 70;
  }
  const wires = edges.map((edge) => {
    const from = positions.get(edge.from)!;
    const to = positions.get(edge.to)!;
    return `<path d="M${from.x + 150} ${from.y + from.height} L${to.x + 150} ${to.y}" fill="none" stroke="currentColor"${edge.condition ? ' stroke-dasharray="5 4"' : ''}/><path d="M${to.x + 146} ${to.y - 7} l4 7 4 -7" fill="none" stroke="currentColor"/>`;
  }).join('');
  const boxes = [...nodes].map(([id, lines]) => {
    const position = positions.get(id)!;
    return `<g><rect x="${position.x}" y="${position.y}" width="300" height="${position.height}" rx="12" fill="var(--surface, Canvas)" stroke="currentColor"/><text x="${position.x + 14}" y="${position.y + 27}" fill="currentColor">${lines.map((line, index) => `<tspan x="${position.x + 14}" dy="${index ? 20 : 0}">${escape(line)}</tspan>`).join('')}</text></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Formules et conditions appliquées" viewBox="0 0 ${width} ${y}" width="${width}" height="${y}">${wires}${boxes}</svg>`;
}
