import { iconSvg } from './document-types.js';
import { graphElements } from './okf.js';
import type { OkfFiche, OkfIndex } from './okf.js';

export type OkfGraph = { center: () => void; destroy: () => void; select: (id: string | null) => void };

type GNode = { id: string; label: string; kind: string; w: number; h: number; x: number; y: number; vx: number; vy: number; fixed: boolean; icon: HTMLImageElement | null };
type GLink = { source: GNode; target: GNode; label: string };

const HEIGHT = 36;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const REPULSION = 9000;
const SPRING = 0.03;
const SPRING_LEN = 150;
const CENTER = 0.01;
const DAMPING = 0.82;
const GAP = 14;

/** Positions de départ sur un cercle déterministe, comme la visualisation de référence. */
function seed(nodes: GNode[]): void {
  const count = nodes.length || 1;
  const radius = 60 + count * 14;
  nodes.forEach((node, i) => {
    const angle = (i / count) * Math.PI * 2;
    node.x = Math.cos(angle) * radius * (0.6 + ((i * 13) % 7) / 10);
    node.y = Math.sin(angle) * radius * (0.6 + ((i * 7) % 5) / 10);
  });
}

/** Un pas de simulation : répulsion, anti-chevauchement des cartouches, ressorts, gravité. Renvoie false une fois refroidi. */
export function stepForces(nodes: GNode[], links: GLink[], alpha: number): boolean {
  if (alpha < 0.005) return false;
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.01; }
      const d = Math.sqrt(d2);
      let force = REPULSION / d2;
      const overlapX = (a.w + b.w) / 2 + GAP - Math.abs(dx);
      const overlapY = (a.h + b.h) / 2 + GAP - Math.abs(dy);
      if (overlapX > 0 && overlapY > 0) force += Math.min(overlapX, overlapY) * 0.15;
      a.vx += (dx / d) * force; a.vy += (dy / d) * force;
      b.vx -= (dx / d) * force; b.vy -= (dy / d) * force;
    }
  }
  for (const { source, target } of links) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const force = (d - SPRING_LEN) * SPRING;
    source.vx += (dx / d) * force; source.vy += (dy / d) * force;
    target.vx -= (dx / d) * force; target.vy -= (dy / d) * force;
  }
  for (const node of nodes) {
    if (node.fixed) { node.vx = 0; node.vy = 0; continue; }
    node.vx = (node.vx - node.x * CENTER) * DAMPING;
    node.vy = (node.vy - node.y * CENTER) * DAMPING;
    node.x += node.vx * alpha;
    node.y += node.vy * alpha;
  }
  return true;
}

export async function mountGraph(container: HTMLElement, index: OkfIndex, withEntities: boolean, onOpen: (fiche: OkfFiche) => void): Promise<OkfGraph> {
  const style = getComputedStyle(container);
  const css = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const text = css('--pmd-text', '#374151');
  const muted = css('--pmd-muted', '#6b7280');
  const border = css('--pmd-border', '#e5e7eb');
  const surface = css('--pmd-surface', '#ffffff');
  const accent = css('--pmd-accent', '#0088ff');
  const kindColor: Record<string, string> = {
    premise: css('--pmd-premise', '#d6cbef'),
    'party-client': css('--pmd-client', '#a8d5b5'),
    'party-adverse': css('--pmd-adverse', '#efb4b4'),
    'party-tiers': css('--pmd-tiers', '#b3cdee'),
  };
  const fontFamily = style.fontFamily || 'sans-serif';
  const font = `500 12px ${fontFamily}`;
  const edgeFont = `10px ${fontFamily}`;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;cursor:grab;touch-action:none';
  container.append(canvas);
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.font = font;

  const elements = graphElements(index, withEntities);
  const nodes: GNode[] = elements.filter((element) => !element.data.source).map(({ data }) => {
    const icon = typeof Image === 'function' ? new Image() : null;
    if (icon) { icon.onload = () => { needDraw = true; }; icon.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(data.icon, text))}`; }
    const width = Math.max(96, Math.min(200, (ctx?.measureText(data.label).width || data.label.length * 7) + 54));
    return { id: data.id, label: data.label, kind: data.kind, w: width, h: HEIGHT, x: 0, y: 0, vx: 0, vy: 0, fixed: false, icon };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const links: GLink[] = elements.filter((element) => element.data.source).flatMap(({ data }) => {
    const source = byId.get(data.source);
    const target = byId.get(data.target);
    return source && target ? [{ source, target, label: data.label }] : [];
  });
  const neighbours = new Map<string, Set<string>>(nodes.map((node) => [node.id, new Set([node.id])]));
  for (const { source, target } of links) { neighbours.get(source.id)!.add(target.id); neighbours.get(target.id)!.add(source.id); }

  let width = 0;
  let height = 0;
  let ratio = 1;
  let view = { x: 0, y: 0, k: 1 };
  let alpha = 1;
  let needDraw = true;
  let selected: string | null = null;
  let hover: GNode | null = null;
  let focus: string | null = null;
  let frame = 0;
  let destroyed = false;

  const toWorld = (sx: number, sy: number) => ({ x: (sx - view.x) / view.k, y: (sy - view.y) / view.k });
  const near = (node: GNode) => { const id = focus ?? selected; return !id || neighbours.get(id)?.has(node.id) === true; };

  const fit = (ids?: Set<string>) => {
    const list = ids ? nodes.filter((node) => ids.has(node.id)) : nodes;
    if (!list.length || !width || !height) { view = { x: width / 2, y: height / 2, k: 1 }; needDraw = true; return; }
    const x1 = Math.min(...list.map((node) => node.x - node.w / 2));
    const x2 = Math.max(...list.map((node) => node.x + node.w / 2));
    const y1 = Math.min(...list.map((node) => node.y - node.h / 2));
    const y2 = Math.max(...list.map((node) => node.y + node.h / 2));
    const pad = 48;
    const k = Math.max(MIN_ZOOM, Math.min(1.2, (width - pad) / Math.max(1, x2 - x1), (height - pad) / Math.max(1, y2 - y1)));
    view = { k, x: width / 2 - ((x1 + x2) / 2) * k, y: height / 2 - ((y1 + y2) / 2) * k };
    needDraw = true;
  };

  const resize = () => {
    width = container.clientWidth;
    height = container.clientHeight;
    ratio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    needDraw = true;
  };

  const pill = (x: number, y: number, w: number, h: number) => {
    ctx!.beginPath();
    ctx!.roundRect ? ctx!.roundRect(x, y, w, h, h / 2) : ctx!.rect(x, y, w, h);
  };

  const draw = () => {
    needDraw = false;
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const active = selected ?? focus;
    for (const { source, target, label } of links) {
      const hot = Boolean(active) && (source.id === active || target.id === active);
      const dim = Boolean(active) && !hot;
      const x1 = source.x * view.k + view.x, y1 = source.y * view.k + view.y;
      const x2 = target.x * view.k + view.x, y2 = target.y * view.k + view.y;
      ctx.globalAlpha = dim ? 0.15 : 1;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.strokeStyle = hot ? muted : border;
      ctx.lineWidth = hot ? 1.5 : 1;
      ctx.stroke();
      if (hot && view.k > 0.4) {
        ctx.font = edgeFont; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, tw = ctx.measureText(label).width;
        ctx.fillStyle = surface; ctx.fillRect(mx - tw / 2 - 4, my - 8, tw + 8, 16);
        ctx.fillStyle = text; ctx.fillText(label, mx, my);
      }
    }
    for (const node of nodes) {
      const w = node.w * view.k, h = node.h * view.k;
      const x = node.x * view.k + view.x - w / 2, y = node.y * view.k + view.y - h / 2;
      if (x > width || y > height || x + w < 0 || y + h < 0) continue;
      const tinted = kindColor[node.kind];
      const isSelected = node.id === selected;
      ctx.globalAlpha = near(node) ? 1 : 0.15;
      pill(x, y, w, h);
      ctx.fillStyle = surface; ctx.fill();
      ctx.lineWidth = isSelected ? 2 : tinted ? 2 : 1;
      ctx.strokeStyle = isSelected || node === hover ? accent : tinted || border;
      ctx.stroke();
      const iconSize = 17 * view.k;
      if (node.icon?.complete && node.icon.naturalWidth) ctx.drawImage(node.icon, x + 13 * view.k, y + (h - iconSize) / 2, iconSize, iconSize);
      if (view.k > 0.35) {
        ctx.font = `500 ${12 * view.k}px ${fontFamily}`;
        ctx.fillStyle = text; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        const room = w - 40 * view.k;
        let label = node.label;
        while (label.length > 1 && ctx.measureText(label).width > room) label = `${label.slice(0, -2)}…`;
        ctx.fillText(label, x + 36 * view.k, y + h / 2);
      }
    }
    ctx.globalAlpha = 1;
  };

  const loop = () => {
    if (destroyed) return;
    if (stepForces(nodes, links, alpha)) { alpha *= 0.985; needDraw = true; }
    if (needDraw) draw();
    frame = requestAnimationFrame(loop);
  };

  const nodeAt = (sx: number, sy: number): GNode | null => {
    const p = toWorld(sx, sy);
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const node = nodes[i];
      if (Math.abs(p.x - node.x) <= node.w / 2 && Math.abs(p.y - node.y) <= node.h / 2) return node;
    }
    return null;
  };
  const local = (event: PointerEvent | WheelEvent) => { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };

  let drag: { node: GNode | null; last: { x: number; y: number }; moved: boolean } | null = null;
  canvas.addEventListener('pointerdown', (event) => {
    const pos = local(event);
    const node = nodeAt(pos.x, pos.y);
    drag = { node, last: pos, moved: false };
    if (node) node.fixed = true;
    canvas.style.cursor = 'grabbing';
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    const pos = local(event);
    if (!drag) {
      const over = nodeAt(pos.x, pos.y);
      if (over !== hover) { hover = over; focus = over?.id ?? null; needDraw = true; canvas.style.cursor = over ? 'pointer' : 'grab'; }
      return;
    }
    const dx = pos.x - drag.last.x, dy = pos.y - drag.last.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    if (drag.node) {
      const world = toWorld(pos.x, pos.y);
      drag.node.x = world.x; drag.node.y = world.y; drag.node.vx = 0; drag.node.vy = 0;
      alpha = Math.max(alpha, 0.3);
    } else { view.x += dx; view.y += dy; }
    drag.last = pos;
    needDraw = true;
  });
  const release = () => {
    if (!drag) return;
    const { node, moved } = drag;
    drag = null;
    canvas.style.cursor = node ? 'pointer' : 'grab';
    if (node) node.fixed = false;
    if (node && !moved) {
      selected = node.id;
      const fiche = index.fiches.find((entry) => entry.id === node.id);
      if (fiche) onOpen(fiche);
    } else if (!node && !moved) { selected = null; }
    needDraw = true;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => { if (!drag && hover) { hover = null; focus = null; needDraw = true; } });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const pos = local(event);
    const world = toWorld(pos.x, pos.y);
    view.k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.k * Math.exp(-event.deltaY * 0.0012)));
    view.x = pos.x - world.x * view.k;
    view.y = pos.y - world.y * view.k;
    needDraw = true;
  }, { passive: false });

  const observer = new ResizeObserver(() => { resize(); });
  observer.observe(container);
  resize();
  seed(nodes);
  for (let i = 0; i < 120; i += 1) { if (stepForces(nodes, links, alpha)) alpha *= 0.985; }
  fit();
  frame = requestAnimationFrame(loop);
  return {
    center: () => { selected = null; fit(); },
    destroy: () => { destroyed = true; cancelAnimationFrame(frame); observer.disconnect(); canvas.remove(); },
    select: (id) => {
      selected = id && byId.has(id) ? id : null;
      fit(selected ? neighbours.get(selected) : undefined);
    },
  };
}
