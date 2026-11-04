export function mountExplanation(container: HTMLElement, openSource: (source: string) => void) {
  const svg = container.querySelector<SVGSVGElement>('svg');
  if (!svg) return () => {};
  const nodes = [...svg.querySelectorAll<SVGGElement>('[data-node]')];
  const wires = [...svg.querySelectorAll<SVGPathElement>('[data-from]')];
  const canvas = container.querySelector<HTMLElement>('.pmc-canvas')!;
  const stage = container.querySelector<HTMLElement>('.pmc-stage')!;
  const inspector = container.querySelector<HTMLElement>('.pmc-inspector')!;
  const chooser = container.querySelector<HTMLSelectElement>('[data-result]')!;
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  let selected = '';
  let zoom = 1;
  let pan = { x: 20, y: 20 };
  let drag: { x: number; y: number; left: number; top: number } | null = null;
  let moved = false;
  let replay = 0;
  let timer = 0;
  const transform = () => { stage.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`; };
  const fit = () => {
    zoom = Math.min(1, Math.max(.75, (canvas.clientWidth - 40) / Number(svg.getAttribute('width'))));
    pan = { x: 20, y: 20 };
    transform();
  };
  const label = (node: SVGGElement) => node.dataset.title ?? '';
  const pending = nodes.filter((node) => node.dataset.tone === 'warn');
  chooser.innerHTML = '<option value="">Toutes les étapes</option>' + nodes.filter((node) => ['calculation', 'conclusion'].includes(node.dataset.kind!)).map((node) => `<option value="${node.dataset.node}">${escape(label(node))}</option>`).join('');
  const ref = (id: string) => {
    const node = nodes.find((item) => item.dataset.node === id)!;
    return `<button class="pmc-link" data-select-node="${id}">${escape(label(node))}</button>`;
  };
  const select = (id: string) => {
    selected = id;
    const branch = new Set(id ? [id] : nodes.map((node) => node.dataset.node!));
    for (let pass = 0; pass < nodes.length; pass++) {
      for (const wire of wires) if (branch.has(wire.dataset.to!)) branch.add(wire.dataset.from!);
    }
    nodes.forEach((node) => {
      node.classList.toggle('is-dim', !branch.has(node.dataset.node!));
      node.setAttribute('aria-pressed', String(node.dataset.node === id));
    });
    wires.forEach((wire) => wire.classList.toggle('is-dim', !branch.has(wire.dataset.from!) || !branch.has(wire.dataset.to!)));
    const node = nodes.find((item) => item.dataset.node === id);
    inspector.hidden = !node;
    if (!node) return;
    const dependencies = wires.filter((wire) => wire.dataset.to === id);
    const consumers = wires.filter((wire) => wire.dataset.from === id);
    inspector.innerHTML = `<header><strong>${escape(label(node))}</strong><button data-close-node aria-label="Fermer le détail">×</button></header><p>${escape(node.dataset.context ?? '')}</p><p class="pmc-${node.dataset.tone === 'neutral' ? 'muted' : node.dataset.tone}">${node.dataset.kind === 'input' ? 'Donnée fournie au scénario' : node.dataset.kind === 'condition' ? 'Condition utilisée dans cette exécution' : 'Valeur calculée par Catala'}${node.dataset.value ? ` : <strong>${escape(node.dataset.value)}</strong>` : ''}.</p>${node.dataset.tone === 'warn' ? '<p class="pmc-warn">État ouvert dans le programme. Établissez la donnée ou tranchez le désaccord avant de conclure.</p>' : ''}${dependencies.length ? `<h4>Dépend de</h4><ul>${dependencies.map((wire) => `<li>${ref(wire.dataset.from!)}${wire.hasAttribute('stroke-dasharray') ? ' · condition' : ''}</li>`).join('')}</ul>` : ''}${consumers.length ? `<h4>Utilisé par</h4><ul>${consumers.map((wire) => `<li>${ref(wire.dataset.to!)}</li>`).join('')}</ul>` : ''}${node.dataset.source ? '<button data-open-source>Ouvrir le programme</button>' : ''}`;
  };
  container.querySelector<HTMLElement>('.pmc-open-states')!.innerHTML = pending.length ? `<details><summary class="pmc-warn">${pending.length} état${pending.length > 1 ? 's' : ''} à éclaircir dans cette exécution</summary><ul>${pending.map((node) => `<li>${ref(node.dataset.node!)} : ${escape(node.dataset.value!)}</li>`).join('')}</ul></details>` : '<span class="pmc-muted">Aucun état ouvert nommé « Indéterminé » ou « Disputé » dans la trace.</span>';
  container.querySelector<HTMLElement>('.pmc-written')!.innerHTML = nodes.map((node) => `<section class="pmc-phase" data-status="${node.dataset.tone === 'warn' ? 'attente' : node.dataset.tone === 'ko' ? 'alerte' : node.dataset.tone}"><header>${ref(node.dataset.node!)}${node.dataset.value ? `<strong>${escape(node.dataset.value)}</strong>` : ''}</header><p class="pmc-muted">${escape(node.dataset.context ?? '')}</p>${wires.some((wire) => wire.dataset.to === node.dataset.node) ? `<p>Dépend de : ${wires.filter((wire) => wire.dataset.to === node.dataset.node).map((wire) => ref(wire.dataset.from!)).join(' · ')}</p>` : ''}</section>`).join('');
  const finishReplay = () => {
    window.clearTimeout(timer);
    replay = 0;
    nodes.forEach((node) => node.classList.remove('is-waiting'));
    wires.forEach((wire) => wire.classList.remove('is-waiting'));
    container.querySelector<HTMLElement>('[data-replay]')!.textContent = 'Dérouler';
  };
  const click = (event: MouseEvent) => {
    const target = event.target as Element;
    const button = target.closest<HTMLElement>('button');
    const node = target.closest<SVGGElement>('[data-node]');
    if (moved) { moved = false; return; }
    if (node) select(node.dataset.node!);
    if (!button) return;
    if (button.dataset.selectNode) {
      select(button.dataset.selectNode);
      container.dataset.mode = 'graph';
      container.querySelectorAll<HTMLElement>('[data-mode]').forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.mode === 'graph')));
      const card = nodes.find((item) => item.dataset.node === selected)!.querySelector('rect')!;
      pan = { x: 30 - Number(card.getAttribute('x')) * zoom, y: 40 - Number(card.getAttribute('y')) * zoom };
      transform();
    }
    if (button.hasAttribute('data-close-node')) { select(''); chooser.value = ''; }
    if (button.hasAttribute('data-open-source')) openSource(nodes.find((item) => item.dataset.node === selected)!.dataset.source!);
    if (button.dataset.mode) {
      container.dataset.mode = button.dataset.mode;
      container.querySelectorAll<HTMLElement>('[data-mode]').forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.mode === button.dataset.mode)));
    }
    if (button.hasAttribute('data-legend')) {
      const legend = container.querySelector<HTMLElement>('.pmc-legend')!;
      legend.hidden = !legend.hidden;
      button.setAttribute('aria-pressed', String(!legend.hidden));
    }
    if (button.dataset.zoom) {
      const next = Math.max(.2, Math.min(2.5, zoom * Number(button.dataset.zoom)));
      pan = { x: canvas.clientWidth / 2 - (canvas.clientWidth / 2 - pan.x) * next / zoom, y: canvas.clientHeight / 2 - (canvas.clientHeight / 2 - pan.y) * next / zoom };
      zoom = next;
      transform();
    }
    if (button.hasAttribute('data-fit')) fit();
    if (button.hasAttribute('data-replay')) {
      if (replay) { finishReplay(); return; }
      select('');
      replay = 1;
      button.textContent = 'Arrêter';
      const revealed = new Set<string>();
      nodes.forEach((entry) => entry.classList.add('is-waiting'));
      wires.forEach((wire) => wire.classList.add('is-waiting'));
      const step = () => {
        const ready = nodes.filter((entry) => !revealed.has(entry.dataset.node!) && wires.filter((wire) => wire.dataset.to === entry.dataset.node).every((wire) => revealed.has(wire.dataset.from!)));
        if (!ready.length) { finishReplay(); return; }
        ready.forEach((entry) => { revealed.add(entry.dataset.node!); entry.classList.remove('is-waiting'); });
        wires.forEach((wire) => wire.classList.toggle('is-waiting', !revealed.has(wire.dataset.from!) || !revealed.has(wire.dataset.to!)));
        timer = window.setTimeout(step, 700);
      };
      step();
    }
  };
  const key = (event: KeyboardEvent) => {
    if ((event.key === 'Enter' || event.key === ' ') && (event.target as Element).closest('[data-node]')) { event.preventDefault(); select((event.target as SVGGElement).dataset.node!); }
    if (event.key === 'Escape') select('');
  };
  const change = () => { select(chooser.value); };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || (event.target as Element).closest('button, select, .pmc-inspector, .pmc-legend')) return;
    moved = false;
    drag = { x: event.clientX, y: event.clientY, left: pan.x, top: pan.y };

  };
  const move = (event: PointerEvent) => {
    if (!drag) return;
    const x = event.clientX - drag.x, y = event.clientY - drag.y;
    if (Math.abs(x) + Math.abs(y) > 4) moved = true;
    if (!moved) return;
    canvas.setPointerCapture(event.pointerId);
    pan = { x: drag.left + x, y: drag.top + y };
    transform();
  };
  const up = () => { drag = null; };
  const wheel = (event: WheelEvent) => {
    if ((event.target as Element).closest('.pmc-inspector, .pmc-legend')) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const next = Math.max(.2, Math.min(2.5, zoom * Math.exp(-event.deltaY / 300)));
    pan = { x: x - (x - pan.x) * next / zoom, y: y - (y - pan.y) * next / zoom };
    zoom = next;
    transform();
  };
  container.addEventListener('click', click);
  container.addEventListener('keydown', key);
  chooser.addEventListener('change', change);
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  fit();
  return () => {
    finishReplay();
    container.removeEventListener('click', click);
    container.removeEventListener('keydown', key);
    chooser.removeEventListener('change', change);
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    canvas.removeEventListener('wheel', wheel);
  };
}
