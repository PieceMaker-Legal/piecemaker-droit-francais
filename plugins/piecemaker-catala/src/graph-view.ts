export function mountExplanation(view: HTMLElement, openReference: (target: string, origin: string, quote: string) => void) {
  const canvas = view.querySelector<HTMLElement>('.pmc-canvas');
  const stage = view.querySelector<HTMLElement>('.pmc-stage');
  const inspector = view.querySelector<HTMLElement>('.pmc-inspector');
  const graph = view.querySelector<HTMLElement>('.pmc-graph');
  const nodes = [...view.querySelectorAll<HTMLElement>('.pmc-graph [data-node]')];
  const wires = [...view.querySelectorAll<SVGPathElement>('.pmc-graph [data-from]')];
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  let drag: { x: number; y: number; left: number; top: number } | null = null;
  let moved = false;
  const transform = () => { if (stage) stage.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`; };
  const fit = () => {
    if (!canvas?.clientWidth || !graph) return;
    zoom = Math.min(1, Math.max(.2, (canvas.clientWidth - 40) / Number(graph.dataset.width)));
    pan = { x: 20, y: 20 };
    transform();
  };
  const select = (id: string) => {
    const branch = new Set(id ? [id] : nodes.map((node) => node.dataset.node!));
    for (let pass = 0; pass < nodes.length; pass++) for (const wire of wires) if (branch.has(wire.dataset.to!)) branch.add(wire.dataset.from!);
    nodes.forEach((node) => {
      node.classList.toggle('is-dim', !branch.has(node.dataset.node!));
      node.setAttribute('aria-pressed', String(node.dataset.node === id));
    });
    wires.forEach((wire) => wire.classList.toggle('is-dim', !branch.has(wire.dataset.from!) || !branch.has(wire.dataset.to!)));
    if (!inspector) return;
    const card = id ? view.querySelector<HTMLElement>(`.pmc-cards [data-card="${id}"]`) : null;
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
    if (moved) { moved = false; event.preventDefault(); return; }
    const reference = target.closest<HTMLElement>('[data-open-reference]');
    if (reference) { event.preventDefault(); openReference(reference.dataset.target ?? '', reference.dataset.origin ?? '', reference.dataset.quote ?? ''); return; }
    const link = target.closest<HTMLElement>('[data-goto]');
    if (link) {
      event.preventDefault();
      if (link.closest('.pmc-written')) goto(link.dataset.goto!);
      else select(link.dataset.goto!);
      return;
    }
    const button = target.closest<HTMLElement>('button');
    if (button?.hasAttribute('data-close-node')) { select(''); return; }
    if (button?.dataset.zoom && canvas) {
      const next = Math.max(.2, Math.min(2.5, zoom * Number(button.dataset.zoom)));
      pan = { x: canvas.clientWidth / 2 - (canvas.clientWidth / 2 - pan.x) * next / zoom, y: canvas.clientHeight / 2 - (canvas.clientHeight / 2 - pan.y) * next / zoom };
      zoom = next;
      transform();
      return;
    }
    if (button?.hasAttribute('data-fit')) { fit(); return; }
    const node = target.closest<HTMLElement>('[data-node]');
    if (node) select(node.dataset.node!);
    else if (!target.closest('.pmc-inspector')) select('');
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { select(''); return; }
    const node = (event.target as Element).closest<HTMLElement>('[data-node]');
    if (node && (event.target as Element) === node && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); select(node.dataset.node!); }
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || (event.target as Element).closest('button, a, .pmc-inspector')) return;
    moved = false;
    drag = { x: event.clientX, y: event.clientY, left: pan.x, top: pan.y };
  };
  const move = (event: PointerEvent) => {
    if (!drag || !canvas) return;
    const x = event.clientX - drag.x, y = event.clientY - drag.y;
    if (Math.abs(x) + Math.abs(y) > 4) moved = true;
    if (!moved) return;
    canvas.setPointerCapture(event.pointerId);
    pan = { x: drag.left + x, y: drag.top + y };
    transform();
  };
  const up = () => { drag = null; };
  const wheel = (event: WheelEvent) => {
    if (!canvas || (event.target as Element).closest('.pmc-inspector')) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const next = Math.max(.2, Math.min(2.5, zoom * Math.exp(-event.deltaY / 300)));
    pan = { x: x - (x - pan.x) * next / zoom, y: y - (y - pan.y) * next / zoom };
    zoom = next;
    transform();
  };
  view.ownerDocument.addEventListener('click', click);
  view.addEventListener('keydown', key);
  canvas?.addEventListener('pointerdown', down);
  canvas?.addEventListener('pointermove', move);
  canvas?.addEventListener('pointerup', up);
  canvas?.addEventListener('pointercancel', up);
  canvas?.addEventListener('wheel', wheel, { passive: false });
  let width = 0;
  const observer = canvas && globalThis.ResizeObserver ? new ResizeObserver(() => { if (!width && canvas.clientWidth) fit(); width = canvas.clientWidth; }) : null;
  if (canvas) observer?.observe(canvas);
  fit();
  return () => {
    observer?.disconnect();
    select('');
    view.ownerDocument.removeEventListener('click', click);
    view.removeEventListener('keydown', key);
    canvas?.removeEventListener('pointerdown', down);
    canvas?.removeEventListener('pointermove', move);
    canvas?.removeEventListener('pointerup', up);
    canvas?.removeEventListener('pointercancel', up);
    canvas?.removeEventListener('wheel', wheel);
  };
}
