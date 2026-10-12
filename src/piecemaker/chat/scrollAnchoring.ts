const PANE_SELECTOR = '.chat-messages-pane';
const ROW_SELECTOR = '[data-message-timestamp]';
const SCROLL_IDLE_MS = 250;
const BOTTOM_TOLERANCE_PX = 2;

type Anchor = { row: HTMLElement; offset: number; scrollTop: number };

function outermostRows(pane: HTMLElement): HTMLElement[] {
  return [...pane.querySelectorAll<HTMLElement>(ROW_SELECTOR)]
    .filter((row) => !row.parentElement?.closest(ROW_SELECTOR));
}

export function anchorPane(pane: HTMLElement): () => void {
  let rows: HTMLElement[] | null = null;
  let anchor: Anchor | null = null;

  const paneTop = () => pane.getBoundingClientRect().top;

  const findAnchor = (): Anchor | null => {
    rows ??= outermostRows(pane);
    const top = paneTop();
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (rows[middle].getBoundingClientRect().bottom > top) high = middle;
      else low = middle + 1;
    }
    const row = rows[low];
    return row ? { row, offset: row.getBoundingClientRect().top - top, scrollTop: pane.scrollTop } : null;
  };

  const record = () => {
    anchor = findAnchor();
  };

  const compensate = () => {
    if (anchor?.row.isConnected) {
      const offset = anchor.row.getBoundingClientRect().top - paneTop();
      const expected = anchor.offset - (pane.scrollTop - anchor.scrollTop);
      const shift = offset - expected;
      if (Math.abs(offset - anchor.offset) >= 1 && Math.abs(shift) >= 1) pane.scrollTop += shift;
    }
    record();
  };

  const resizeObserver = new ResizeObserver(compensate);
  const observeChildren = () => {
    for (const child of pane.children) resizeObserver.observe(child);
  };
  const mutationObserver = new MutationObserver(() => {
    rows = null;
    observeChildren();
  });

  observeChildren();
  mutationObserver.observe(pane, { childList: true, subtree: true });
  pane.addEventListener('scroll', record, { passive: true });
  record();

  return () => {
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    pane.removeEventListener('scroll', record);
  };
}

export function offsetShiftsWhileScrolling(pane: HTMLElement): () => void {
  const measured = new WeakMap<Element, { height: number; placeholder: boolean }>();
  let pending = 0;
  let touching = false;
  let pinnedToBottom = false;
  let idleTimer = 0;

  const contentBlocks = () => [...pane.children].filter((child): child is HTMLElement => child instanceof HTMLElement && !!child.querySelector(ROW_SELECTOR));
  const pullUp = (offset: number) => {
    for (const block of contentBlocks()) block.style.marginTop = offset ? `${-offset}px` : '';
  };

  const flush = () => {
    idleTimer = 0;
    if (touching || !pending) return;
    const offset = pending;
    pending = 0;
    pullUp(0);
    pane.scrollTop += offset;
  };

  const waitForIdle = () => {
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(flush, SCROLL_IDLE_MS);
  };

  const onScroll = () => {
    pinnedToBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < BOTTOM_TOLERANCE_PX;
    waitForIdle();
  };

  const compensate = (rows: Iterable<Element>) => {
    const paneTop = pane.getBoundingClientRect().top;
    const resized = [...rows]
      .map((row) => ({ row, rect: row.getBoundingClientRect() }))
      .sort((a, b) => a.rect.top - b.rect.top);
    let shift = 0;
    for (const { row, rect } of resized) {
      const previous = measured.get(row);
      measured.set(row, { height: rect.height, placeholder: !!(row as HTMLElement).style.height });
      if (!previous) continue;
      const top = rect.top - shift;
      const above = top + previous.height <= paneTop + 1;
      const mountedAcrossTop = previous.placeholder && top < paneTop;
      if (above || mountedAcrossTop) shift += rect.height - previous.height;
    }
    if (pinnedToBottom && !touching) {
      pending = 0;
      pullUp(0);
      pane.scrollTop = pane.scrollHeight;
      return;
    }
    if (Math.abs(shift) < 0.5) return;
    if (touching || idleTimer) {
      pending += shift;
      pullUp(pending);
    } else {
      pane.scrollTop += shift;
    }
  };

  const resizeObserver = new ResizeObserver((entries) => compensate(entries.map(({ target }) => target)));

  const observeRows = () => {
    for (const row of outermostRows(pane)) resizeObserver.observe(row);
  };
  const outermostRow = (node: Node) => {
    let row = (node instanceof Element ? node : node.parentElement)?.closest(ROW_SELECTOR) ?? null;
    while (row?.parentElement?.closest(ROW_SELECTOR)) row = row.parentElement.closest(ROW_SELECTOR);
    return row;
  };
  const mutationObserver = new MutationObserver((records) => {
    const rows = new Set<Element>();
    for (const { target } of records) {
      const row = outermostRow(target);
      if (row && measured.has(row)) rows.add(row);
    }
    if (rows.size) compensate(rows);
    observeRows();
  });

  const onTouchStart = () => {
    touching = true;
  };
  const onTouchEnd = () => {
    touching = false;
    waitForIdle();
  };

  const previousOverflowAnchor = pane.style.overflowAnchor;
  pane.style.overflowAnchor = 'none';
  observeRows();
  mutationObserver.observe(pane, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  pane.addEventListener('scroll', onScroll, { passive: true });
  pane.addEventListener('touchstart', onTouchStart, { passive: true });
  pane.addEventListener('touchend', onTouchEnd, { passive: true });
  pane.addEventListener('touchcancel', onTouchEnd, { passive: true });

  return () => {
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    window.clearTimeout(idleTimer);
    pane.removeEventListener('scroll', onScroll);
    pane.removeEventListener('touchstart', onTouchStart);
    pane.removeEventListener('touchend', onTouchEnd);
    pane.removeEventListener('touchcancel', onTouchEnd);
    touching = false;
    flush();
    pane.style.overflowAnchor = previousOverflowAnchor;
  };
}

export function startScrollAnchoring(): () => void {
  if (typeof CSS === 'undefined') return () => undefined;
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  if (CSS.supports('overflow-anchor', 'auto')) return () => undefined;
  const touchWebKit = CSS.supports('-webkit-touch-callout', 'none');
  const anchored = new Map<HTMLElement, () => void>();
  let frame = 0;

  const attach = (pane: HTMLElement) => (touchWebKit ? offsetShiftsWhileScrolling(pane) : anchorPane(pane));

  const sync = () => {
    frame = 0;
    for (const [pane, stop] of anchored) {
      if (pane.isConnected) continue;
      stop();
      anchored.delete(pane);
    }
    for (const pane of document.querySelectorAll<HTMLElement>(PANE_SELECTOR)) {
      if (!anchored.has(pane)) anchored.set(pane, attach(pane));
    }
  };

  const observer = new MutationObserver(() => {
    if (!frame) frame = requestAnimationFrame(sync);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  sync();

  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    anchored.forEach((stop) => stop());
    anchored.clear();
  };
}
