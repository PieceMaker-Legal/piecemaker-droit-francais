import { logicalText } from './source-context.js';

export function mountExplanation(container: HTMLElement, openSource: (source: string) => void, openReference: (target: string, origin: string) => void = () => {}) {
  const svg = container.querySelector<SVGSVGElement>('svg');
  if (!svg) return () => {};
  const view = container.closest<HTMLElement>('.pmc-view')!;
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
    zoom = Math.min(1, Math.max(.2, (canvas.clientWidth - 40) / Number(svg.getAttribute('width'))));
    pan = { x: 20, y: 20 };
    transform();
  };
  const label = (node: SVGGElement) => node.dataset.title ?? '';
  const expression = (node: SVGGElement) => node.dataset.expression ? `<div class="pmc-expression">${node.dataset.kind === 'condition' ? logicalText(node.dataset.expression) : escape(node.dataset.expression)}</div>` : '';
  const referenceAction = (node: SVGGElement) => node.dataset.target ? `<button data-open-reference="${node.dataset.node}">${node.dataset.kind === 'control' ? 'Ouvrir le journal' : 'Ouvrir la référence'}</button>` : ['piece', 'article', 'jurisprudence', 'reference'].includes(node.dataset.kind!) ? '<p class="pmc-warn">Lien absent du programme : référence impossible à ouvrir.</p>' : '';
  const pending = nodes.filter((node) => Boolean(node.dataset.issue));
  chooser.innerHTML = '<option value="">Toutes les étapes</option>' + nodes.filter((node) => ['calculation', 'conclusion'].includes(node.dataset.kind!)).map((node) => `<option value="${node.dataset.node}">Étape ${node.dataset.step} · ${escape(label(node))}</option>`).join('');
  chooser.innerHTML += '<optgroup label="Contrôles et références">' + nodes.filter((node) => ['control', 'piece', 'article', 'jurisprudence', 'reference'].includes(node.dataset.kind!)).map((node) => `<option value="${node.dataset.node}">${escape(label(node))}</option>`).join('') + '</optgroup>';
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
    const dependencies = wires.filter((wire) => wire.dataset.to === id && wire.dataset.relation !== 'control');
    const checks = wires.filter((wire) => wire.dataset.to === id && wire.dataset.relation === 'control');
    const consumers = wires.filter((wire) => wire.dataset.from === id);
    inspector.innerHTML = `<header><strong>${escape(label(node))}</strong><button data-close-node aria-label="Fermer le détail">×</button></header><p>${escape(node.dataset.context ?? '')}</p>${expression(node)}${node.dataset.issue ? `<p class="pmc-warn">${escape(node.dataset.issue)}</p>` : ''}${node.dataset.literaryContext ? `<p class="pmc-source-text">${escape(node.dataset.literaryContext)}</p>` : ''}<p class="pmc-${node.dataset.tone === 'neutral' ? 'muted' : node.dataset.tone}">${node.dataset.kind === 'input' ? 'Donnée fournie au scénario' : node.dataset.kind === 'condition' ? 'Condition utilisée dans cette exécution' : ['piece', 'article', 'jurisprudence', 'reference'].includes(node.dataset.kind!) ? 'Référence déclarée dans le programme' : node.dataset.kind === 'control' ? 'Résultat du contrôle du programme' : 'Valeur calculée par Catala'}${node.dataset.value ? ` : <strong>${escape(node.dataset.value)}</strong>` : ''}.</p>${dependencies.length ? `<h4>Dépend de</h4><ul>${dependencies.map((wire) => `<li>${ref(wire.dataset.from!)}${wire.dataset.relation === 'control' ? ' · bilan du programme' : wire.hasAttribute('stroke-dasharray') ? ' · condition' : ''}</li>`).join('')}</ul>` : ''}${checks.length ? `<h4>Bilans associés</h4><ul>${checks.map((wire) => `<li>${ref(wire.dataset.from!)}</li>`).join('')}</ul>` : ''}${consumers.length ? `<h4>Utilisé par</h4><ul>${consumers.map((wire) => `<li>${ref(wire.dataset.to!)}</li>`).join('')}</ul>` : ''}${referenceAction(node)}${node.dataset.source ? '<button data-open-source>Ouvrir le programme</button>' : ''}`;
  };
  const reach = (id: string) => {
    select(id);
    if (!id) return;
    const card = nodes.find((item) => item.dataset.node === id)!.querySelector('rect')!;
    pan = { x: 30 - Number(card.getAttribute('x')) * zoom, y: 40 - Number(card.getAttribute('y')) * zoom };
    transform();
  };
  container.querySelector<HTMLElement>('.pmc-open-states')!.innerHTML = pending.length ? `<details><summary class="pmc-warn">${pending.length} point${pending.length > 1 ? 's' : ''} à résoudre</summary><ul>${pending.map((node) => `<li>${ref(node.dataset.node!)} : ${escape(node.dataset.issue!)}</li>`).join('')}</ul></details>` : '<span class="pmc-muted">Aucun manque explicite détecté dans les données et références de cette trace.</span>';
  view.querySelector<HTMLElement>('.pmc-step-list')!.innerHTML = [...new Set(nodes.map((node) => node.dataset.step ?? ''))].sort((a, b) => Number(a || Infinity) - Number(b || Infinity)).map((step) => {
    const members = nodes.filter((node) => node.dataset.step === step);
    const main = members.find((node) => ['calculation', 'conclusion'].includes(node.dataset.kind!));
    return `<section class="pmc-written-step"><h3>${main?.dataset.kind === 'conclusion' ? 'Réponse · ' : ''}${step ? `Étape ${step}` : 'Contrôles et références hors trace'}${main ? ` · ${escape(label(main))}` : ''}</h3><div class="pmc-written-branches">${members.map((node) => `<section class="pmc-phase" data-status="${node.dataset.tone === 'warn' ? 'attente' : node.dataset.tone === 'ko' ? 'alerte' : node.dataset.tone}"><header>${ref(node.dataset.node!)}${node.dataset.value ? `<strong>${escape(node.dataset.value)}</strong>` : ''}</header><p class="pmc-muted">${escape(node.dataset.context ?? '')}</p>${expression(node)}${node.dataset.issue ? `<p class="pmc-warn">${escape(node.dataset.issue)}</p>` : ''}${node.dataset.literaryContext ? `<p class="pmc-source-text">${escape(node.dataset.literaryContext)}</p>` : ''}${referenceAction(node)}${wires.some((wire) => wire.dataset.to === node.dataset.node && wire.dataset.relation !== 'control') ? `<p>Dépend de : ${wires.filter((wire) => wire.dataset.to === node.dataset.node && wire.dataset.relation !== 'control').map((wire) => ref(wire.dataset.from!)).join(' · ')}</p>` : ''}</section>`).join('')}</div></section>`;
  }).join('');
  const finishReplay = () => {
    window.clearTimeout(timer);
    replay = 0;
    nodes.forEach((node) => { node.classList.remove('is-waiting'); node.removeAttribute('aria-hidden'); });
    svg.querySelectorAll('[data-step-heading]').forEach((heading) => heading.classList.remove('is-waiting'));
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
      view.querySelector<HTMLElement>('[role="tab"][data-mode="graph"]')?.click();
      reach(button.dataset.selectNode);
    }
    if (button.hasAttribute('data-close-node')) { select(''); chooser.value = ''; }
    if (button.hasAttribute('data-open-reference')) { const chosen = nodes.find((item) => item.dataset.node === button.dataset.openReference)!; openReference(chosen.dataset.target!, chosen.dataset.origin ?? ''); }
    if (button.hasAttribute('data-open-source')) openSource(nodes.find((item) => item.dataset.node === selected)!.dataset.source!);
    if (button.dataset.mode) {
      view.dataset.mode = button.dataset.mode;
      view.querySelectorAll<HTMLElement>('[role="tab"][data-mode]').forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.mode === button.dataset.mode)));
      view.querySelector<HTMLElement>('.pmc-explanation')!.hidden = button.dataset.mode !== 'graph';
      view.querySelector<HTMLElement>('.pmc-written')!.hidden = button.dataset.mode !== 'written';
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
      const stages = [...new Set(nodes.map((entry) => entry.dataset.step ?? ''))].sort((a, b) => Number(a || Infinity) - Number(b || Infinity)).flatMap((stage) => [...new Set(nodes.filter((entry) => entry.dataset.step === stage).map((entry) => Number(entry.dataset.column)))].sort((a, b) => a - b).map((column) => ({ stage, column })));
      nodes.forEach((entry) => entry.setAttribute('aria-hidden', 'true'));
      svg.querySelectorAll('[data-step-heading]').forEach((heading) => heading.classList.add('is-waiting'));
      let stageIndex = 0;
      const step = () => {
        const current = nodes.filter((entry) => entry.dataset.step === stages[stageIndex].stage && Number(entry.dataset.column) === stages[stageIndex].column);
        const active = current.find((entry) => ['calculation', 'conclusion'].includes(entry.dataset.kind!));
        if (!current.length) { finishReplay(); return; }
        current.forEach((entry) => { revealed.add(entry.dataset.node!); entry.classList.remove('is-waiting'); entry.removeAttribute('aria-hidden'); });
        svg.querySelector(`[data-step-heading="${stages[stageIndex].stage}"]`)?.classList.remove('is-waiting');
        wires.forEach((wire) => wire.classList.toggle('is-waiting', !revealed.has(wire.dataset.from!) || !revealed.has(wire.dataset.to!)));
        if (active) select(active.dataset.node!);
        else if (!stages[stageIndex].stage) select('');
        if (current.length) {
          const rect = current[0].querySelector('rect')!;
          pan = { x: canvas.clientWidth / 2 - (Number(rect.getAttribute('x')) + 140) * zoom, y: canvas.clientHeight / 2 - (Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')) / 2) * zoom };
          transform();
        }
        stageIndex++;
        if (stageIndex < stages.length) timer = window.setTimeout(step, 700);
        else timer = window.setTimeout(finishReplay, 700);
      };
      step();
    }
  };
  const key = (event: KeyboardEvent) => {
    if ((event.key === 'Enter' || event.key === ' ') && (event.target as Element).closest('[data-node]') && !(event.target as Element).closest('button')) { event.preventDefault(); select((event.target as SVGGElement).dataset.node!); }
    if (event.key === 'Escape') select('');
  };
  const change = () => { reach(chooser.value); };
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
  view.addEventListener('click', click);
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
    select('');
    view.removeEventListener('click', click);
    container.removeEventListener('keydown', key);
    chooser.removeEventListener('change', change);
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    canvas.removeEventListener('wheel', wheel);
  };
}
