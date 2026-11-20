export function mountExplanation(view: HTMLElement, openReference: (target: string, origin: string, quote: string, id: string, parent: string) => void) {
  const nodes = [...view.querySelectorAll<HTMLElement>('[data-node]')];
  const canvas = view.querySelector<HTMLElement>('.pmc-map');
  const edges = [...view.querySelectorAll<HTMLElement>('[data-from][data-to]')];
  const scroll = view.querySelector<HTMLElement>('.pmc-map-scroll');
  const draw = () => [...view.querySelectorAll<HTMLElement>('.pmc-map')].forEach((canvas) => {
    const wires = canvas.querySelector<SVGSVGElement>(':scope > .pmc-wires');
    if (!wires) return;
    const frame = canvas.getBoundingClientRect();
    const scale = frame.width / canvas.offsetWidth || 1;
    const selecting = nodes.some((node) => node.classList.contains('is-dim'));
    wires.innerHTML = [...canvas.querySelectorAll<HTMLElement>('.pmc-children')].flatMap((group) => {
      const source = group.previousElementSibling!;
      const from = (source.matches('.pmc-root') ? source.firstElementChild! : source).getBoundingClientRect();
      return [...group.children].map((child) => {
        const to = child.firstElementChild!.getBoundingClientRect();
        const [x1, y1, x2, y2] = [from.right - frame.left, from.top + from.height / 2 - frame.top, to.left - frame.left, to.top + to.height / 2 - frame.top].map((value) => Math.round(value / scale));
        const middle = (x1 + x2) / 2;
        return `<path data-state="${(child as HTMLElement).dataset.state ?? ''}"${selecting && !child.querySelector('[data-node]:not(.is-dim)') ? ' class="is-dim"' : ''} d="M${x1} ${y1}C${middle} ${y1} ${middle} ${y2} ${x2} ${y2}"/>`;
      });
    }).join('');
  });
  const select = (id: string) => {
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
    draw();
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
    if (reference) { event.preventDefault(); openReference(reference.dataset.target ?? '', reference.dataset.origin ?? '', reference.dataset.quote ?? '', reference.dataset.id ?? '', reference.dataset.parent ?? ''); return; }
    const link = target.closest<HTMLElement>('[data-goto]');
    if (link) {
      event.preventDefault();
      if (view.dataset.mode === 'written') goto(link.dataset.goto!);
      else {
        const destination = nodes.find((node) => !node.closest('[hidden]') && (node.dataset.card === link.dataset.goto || node.dataset.summaryOf?.split(' ').includes(link.dataset.goto!)));
        const owner = link.closest<HTMLElement>('[data-node]');
        select(destination?.dataset.node ?? owner?.dataset.node ?? '');
        destination?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      }
      return;
    }
    const node = target.closest<HTMLElement>('[data-node]');
    select(node?.dataset.node ?? '');
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { select(''); return; }
    const node = (event.target as Element).closest<HTMLElement>('[data-node]');
    if (node && (event.target as Element) === node && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); select(node.dataset.node!); }
  };
  const Observer = view.ownerDocument.defaultView?.ResizeObserver;
  const watch = Observer ? new Observer(draw) : null;
  if (canvas) watch?.observe(canvas);
  if (scroll) watch?.observe(scroll);
  scroll?.addEventListener('scroll', draw);
  draw();
  view.ownerDocument.addEventListener('click', click);
  view.addEventListener('keydown', key);
  return () => {
    select('');
    watch?.disconnect();
    scroll?.removeEventListener('scroll', draw);
    view.ownerDocument.removeEventListener('click', click);
    view.removeEventListener('keydown', key);
  };
}
