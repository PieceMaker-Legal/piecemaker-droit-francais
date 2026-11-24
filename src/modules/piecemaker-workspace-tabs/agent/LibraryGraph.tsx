import { useMemo } from 'react';

import type { Library } from '@/modules/piecemaker-workspace-tabs/agent/libraryApi';

export const TYPE_COLORS: Record<string, string> = {
  Template: '#2563eb', Guideline: '#16a34a', Domaine: '#9333ea', Projet: '#ea580c', Client: '#db2777',
};
const WIDTH = 640;
const HEIGHT = 440;

/** Disposition par forces calculée une fois (répulsion, ressorts sur les liens, gravité vers le centre). */
export function layout(ids: string[], edges: Array<{ from: string; to: string }>, steps = 220) {
  const index = new Map(ids.map((id, position) => [id, position]));
  const points = ids.map((_, position) => {
    const angle = position * 2.399963;
    const radius = 12 * Math.sqrt(position + 1);
    return { x: WIDTH / 2 + radius * Math.cos(angle), y: HEIGHT / 2 + radius * Math.sin(angle), vx: 0, vy: 0 };
  });
  const links = edges.flatMap((edge) => index.has(edge.from) && index.has(edge.to) ? [[index.get(edge.from)!, index.get(edge.to)!]] : []);
  for (let step = 0; step < steps; step += 1) {
    for (let a = 0; a < points.length; a += 1) for (let b = a + 1; b < points.length; b += 1) {
      const dx = points[a].x - points[b].x || 0.01;
      const dy = points[a].y - points[b].y || 0.01;
      const force = 900 / Math.max(dx * dx + dy * dy, 25);
      points[a].vx += dx * force; points[a].vy += dy * force;
      points[b].vx -= dx * force; points[b].vy -= dy * force;
    }
    for (const [a, b] of links) {
      const dx = points[b].x - points[a].x;
      const dy = points[b].y - points[a].y;
      points[a].vx += dx * 0.01; points[a].vy += dy * 0.01;
      points[b].vx -= dx * 0.01; points[b].vy -= dy * 0.01;
    }
    for (const point of points) {
      point.vx += (WIDTH / 2 - point.x) * 0.004; point.vy += (HEIGHT / 2 - point.y) * 0.004;
      point.x = Math.min(WIDTH - 12, Math.max(12, point.x + point.vx * 0.5));
      point.y = Math.min(HEIGHT - 12, Math.max(12, point.y + point.vy * 0.5));
      point.vx *= 0.6; point.vy *= 0.6;
    }
  }
  return new Map(ids.map((id, position) => [id, points[position]]));
}

export function LibraryGraph({ library, selected, onSelect }: { library: Library; selected: string | null; onSelect: (id: string) => void }) {
  const ids = useMemo(() => library.concepts.map((concept) => concept.id), [library.concepts]);
  const positions = useMemo(() => layout(ids, library.edges), [ids, library.edges]);
  const near = new Set(selected ? library.edges.flatMap((edge) => edge.from === selected ? [edge.to] : edge.to === selected ? [edge.from] : []) : []);
  return <div className="px-3 py-2">
    <svg role="img" aria-label="Graphe de la Library" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full rounded-xl border border-border bg-background">
      {library.edges.map((edge) => {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) return null;
        const lit = selected && (edge.from === selected || edge.to === selected);
        return <line key={`${edge.from}→${edge.to}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="currentColor" className={lit ? 'text-foreground' : 'text-border'} strokeWidth={lit ? 1.5 : 1} />;
      })}
      {library.concepts.map((concept) => {
        const point = positions.get(concept.id)!;
        const active = concept.id === selected;
        return <g key={concept.id} transform={`translate(${point.x},${point.y})`} className="cursor-pointer" onClick={() => onSelect(concept.id)}>
          <title>{`${concept.type} · ${concept.title}`}</title>
          <circle r={active ? 8 : 6} fill={TYPE_COLORS[concept.type] ?? '#64748b'} opacity={selected && !active && !near.has(concept.id) ? 0.35 : 1} />
          {(active || near.has(concept.id)) && <text x={10} y={4} className="fill-foreground text-[11px]">{concept.title}</text>}
        </g>;
      })}
    </svg>
    <ul className="flex flex-wrap gap-3 px-1 pt-2 text-xs text-muted-foreground">
      {Object.entries(TYPE_COLORS).map(([type, color]) => <li key={type} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />{type}</li>)}
    </ul>
  </div>;
}
