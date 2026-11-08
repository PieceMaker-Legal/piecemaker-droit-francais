export function mountExplanation(view: HTMLElement, openReference: (target: string, origin: string, quote: string, id: string) => void) {
  const inspector = view.querySelector<HTMLElement>('.pmc-inspector');
  const nodes = [...view.querySelectorAll<HTMLElement>('[data-node]')];
  const canvas = view.querySelector<HTMLElement>('.pmc-map');
  const edges = [...view.querySelectorAll<SVGGElement>('[data-from][data-to]')];
  const draw = () => {
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const svg = canvas.querySelector('svg')!;
    svg.setAttribute('width', String(canvas.scrollWidth));
    svg.setAttribute('height', String(canvas.scrollHeight));
    for (const edge of edges) {
      const from = nodes.find((node) => node.dataset.node === edge.dataset.from)?.getBoundingClientRect();
      const to = nodes.find((node) => node.dataset.node === edge.dataset.to)?.getBoundingClientRect();
      if (!from || !to) continue;
      const x1 = from.right - bounds.left, y1 = from.top + from.height / 2 - bounds.top;
      const x2 = to.left - bounds.left, y2 = to.top + to.height / 2 - bounds.top;
      const middle = (x1 + x2) / 2;
      edge.querySelector('path')!.setAttribute('d', `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`);
      const text = edge.querySelector('text')!;
      text.setAttribute('x', String(middle));
      text.setAttribute('y', String((y1 + y2) / 2 - 5));
    }
  };
  const Observer = view.ownerDocument.defaultView?.ResizeObserver;
  const observer = Observer ? new Observer(draw) : null;
  if (canvas) observer?.observe(canvas);
  nodes.forEach((node) => observer?.observe(node));
  draw();
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
    if (!inspector) return;
    const chosen = nodes.find((node) => node.dataset.node === id);
    const card = chosen ? view.querySelector<HTMLElement>(`.pmc-cards [data-card="${chosen.dataset.card}"]`) : null;
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
    const reference = target.closest<HTMLElement>('[data-open-reference]');
    if (reference) { event.preventDefault(); openReference(reference.dataset.target ?? '', reference.dataset.origin ?? '', reference.dataset.quote ?? '', reference.dataset.id ?? ''); return; }
    const link = target.closest<HTMLElement>('[data-goto]');
    if (link) {
      event.preventDefault();
      if (link.closest('.pmc-written')) goto(link.dataset.goto!);
      else select(nodes.find((node) => node.dataset.card === link.dataset.goto)?.dataset.node ?? '');
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
