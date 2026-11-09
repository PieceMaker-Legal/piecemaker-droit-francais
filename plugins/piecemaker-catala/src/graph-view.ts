export function mountExplanation(view: HTMLElement, openReference: (target: string, origin: string, quote: string, id: string) => void) {
  const inspector = view.querySelector<HTMLElement>('.pmc-inspector');
  const nodes = [...view.querySelectorAll<HTMLElement>('[data-node]')];
  const canvas = view.querySelector<HTMLElement>('.pmc-map');
  const edges = [...view.querySelectorAll<SVGGElement>('[data-from][data-to]')];
  const draw = () => {
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const scale = Number(canvas.dataset.scale ?? 1);
    const svg = canvas.querySelector('svg')!;
    svg.setAttribute('width', String(canvas.scrollWidth));
    svg.setAttribute('height', String(canvas.scrollHeight));
    for (const edge of edges) {
      const from = nodes.find((node) => node.dataset.node === edge.dataset.from)?.getBoundingClientRect();
      const to = nodes.find((node) => node.dataset.node === edge.dataset.to)?.getBoundingClientRect();
      if (!from || !to) continue;
      const source = canvas.querySelector<HTMLElement>(`[data-flow-anchor="${edge.dataset.anchorFrom}"]`)?.getBoundingClientRect() ?? nodes.find((node) => node.dataset.node === edge.dataset.from)?.querySelector('.pmc-consequence')?.getBoundingClientRect() ?? from;
      const target = canvas.querySelector<HTMLElement>(`[data-flow-anchor="${edge.dataset.anchorTo}"]`)?.getBoundingClientRect() ?? to;
      let path: string;
      if (edge.dataset.route === 'consequence') {
        const x1 = (source.left + source.width / 2 - bounds.left) / scale, y1 = (source.bottom - bounds.top) / scale;
        const x2 = (target.left + target.width / 2 - bounds.left) / scale, y2 = (target.top - bounds.top) / scale;
        const middle = (y1 + y2) / 2;
        path = `M ${x1} ${y1} V ${middle} H ${x2} V ${y2}`;
      } else if (edge.dataset.route) {
        const backwards = edge.dataset.route === 'supports';
        const x1 = ((backwards ? source.left : source.right) - bounds.left) / scale, y1 = (source.top + source.height / 2 - bounds.top) / scale;
        const x2 = ((backwards ? target.right : target.left) - bounds.left) / scale, y2 = (target.top + target.height / 2 - bounds.top) / scale;
        const middle = (x1 + x2) / 2;
        path = `M ${x1} ${y1} H ${middle} V ${y2} H ${x2}`;
      } else {
        const x1 = (source.left - bounds.left) / scale, y1 = (source.top + source.height / 2 - bounds.top) / scale;
        const x2 = (target.left - bounds.left) / scale, y2 = (target.top + target.height / 2 - bounds.top) / scale;
        const lane = 14 + edges.indexOf(edge) % 4 * 10;
        path = `M ${x1} ${y1} H ${lane} V ${y2} H ${x2}`;
      }
      edge.querySelector('path')!.setAttribute('d', path);
    }
  };
  const Observer = view.ownerDocument.defaultView?.ResizeObserver;
  const observer = Observer ? new Observer(draw) : null;
  if (canvas) observer?.observe(canvas);
  nodes.forEach((node) => observer?.observe(node));
  view.querySelectorAll<HTMLElement>('[data-flow-anchor]').forEach((box) => observer?.observe(box));
  draw();
  const scroll = view.querySelector<HTMLElement>('.pmc-map-scroll');
  const select = (id: string, detailId?: string) => {
    const related = new Set(id ? [id] : []);
    for (const direction of ['from', 'to'] as const) {
      const queue = id ? [id] : [];
      const seen = new Set(queue);
      for (let at = 0; at < queue.length; at++) for (const edge of edges) {
        const next = edge.dataset[direction === 'from' ? 'to' : 'from']!;
        if (edge.dataset[direction] === queue[at] && !seen.has(next)) { seen.add(next); related.add(next); queue.push(next); }
      }
    }
    nodes.forEach((node) => {
      const on = node.dataset.node === id;
      node.classList.toggle('is-selected', on);
      node.classList.toggle('is-dim', Boolean(id) && !related.has(node.dataset.node!));
      if (node.hasAttribute('aria-pressed')) node.setAttribute('aria-pressed', String(on));
    });
    edges.forEach((edge) => edge.classList.toggle('is-dim', Boolean(id) && !(related.has(edge.dataset.from!) && related.has(edge.dataset.to!))));
    if (!inspector) return;
    const chosen = nodes.find((node) => node.dataset.node === id);
    const card = chosen ? view.querySelector<HTMLElement>(`.pmc-cards [data-card="${detailId ?? chosen.dataset.card}"]`) : null;
    inspector.hidden = !card;
    if (card) inspector.innerHTML = `<button class="pmc-close" data-close-node aria-label="Fermer le détail">×</button>${card.outerHTML}`;
  };
  const goto = (id: string) => {
    const card = view.querySelector<HTMLElement>(`.pmc-written [data-card="${id}"]`);
    if (!card) return;
    card.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    card.classList.add('is-focus');
    window.setTimeout(() => card.classList.remove('is-focus'), 1200);
  };
  const click = (event: MouseEvent) => {
    const target = event.target as Element;
    if (!view.contains(target)) { select(''); return; }
    const zoom = target.closest<HTMLElement>('[data-map-zoom]');
    if (zoom && canvas && scroll) {
      const scale = Number(canvas.dataset.scale ?? 1);
      const next = zoom.dataset.mapZoom === 'fit' ? Math.min(1, (scroll.clientWidth - 40) / canvas.scrollWidth) : scale * (zoom.dataset.mapZoom === 'in' ? 1.2 : 1 / 1.2);
      canvas.dataset.scale = String(Math.max(.4, Math.min(2, next)));
      canvas.style.zoom = canvas.dataset.scale;
      draw();
      return;
    }
    const reference = target.closest<HTMLElement>('[data-open-reference]');
    if (reference) { event.preventDefault(); openReference(reference.dataset.target ?? '', reference.dataset.origin ?? '', reference.dataset.quote ?? '', reference.dataset.id ?? ''); return; }
    const link = target.closest<HTMLElement>('[data-goto]');
    if (link) {
      event.preventDefault();
      if (link.closest('.pmc-written')) goto(link.dataset.goto!);
      else {
        const destination = nodes.find((node) => node.dataset.card === link.dataset.goto);
        const owner = link.closest<HTMLElement>('[data-node]');
        select(destination?.dataset.node ?? owner?.dataset.node ?? '', link.dataset.goto);
        destination?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      }
      return;
    }
    if (target.closest<HTMLElement>('button')?.hasAttribute('data-close-node')) { select(''); return; }
    const node = target.closest<HTMLElement>('[data-node]');
    if (node) select(node.dataset.node!);
    else if (!target.closest('.pmc-inspector')) select('');
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { select(''); return; }
    const node = (event.target as Element).closest<HTMLElement>('[data-node]');
    if (node && (event.target as Element) === node && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); select(node.dataset.node!); }
  };
  view.ownerDocument.addEventListener('click', click);
  view.addEventListener('keydown', key);
  return () => {
    observer?.disconnect();
    select('');
    view.ownerDocument.removeEventListener('click', click);
    view.removeEventListener('keydown', key);
  };
}
