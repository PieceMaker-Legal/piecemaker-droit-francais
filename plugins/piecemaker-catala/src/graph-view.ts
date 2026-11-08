export function mountExplanation(view: HTMLElement, openReference: (target: string, origin: string, quote: string, id: string) => void) {
  const inspector = view.querySelector<HTMLElement>('.pmc-inspector');
  const nodes = [...view.querySelectorAll<HTMLElement>('[data-node]')];
  const canvas = view.querySelector<HTMLElement>('.pmc-map');
  const scroll = view.querySelector<HTMLElement>('.pmc-map-scroll');
  const select = (id: string, detailId?: string) => {
    const chosenItem = nodes.find((node) => node.dataset.node === id)?.closest('li');
    const related = new Set(id ? [id] : []);
    chosenItem?.querySelectorAll<HTMLElement>('[data-node]').forEach((node) => related.add(node.dataset.node!));
    for (let item = chosenItem?.parentElement?.closest('li'); item; item = item.parentElement?.closest('li')) {
      const owner = item.querySelector<HTMLElement>(':scope > [data-node]');
      if (owner) related.add(owner.dataset.node!);
    }
    nodes.forEach((node) => {
      const on = node.dataset.node === id;
      node.classList.toggle('is-selected', on);
      node.classList.toggle('is-dim', Boolean(id) && !related.has(node.dataset.node!));
      if (node.hasAttribute('aria-pressed')) node.setAttribute('aria-pressed', String(on));
    });
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
    select('');
    view.ownerDocument.removeEventListener('click', click);
    view.removeEventListener('keydown', key);
  };
}
