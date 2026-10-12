const PANE_SELECTOR = '.chat-messages-pane';
const ROW_SELECTOR = '[data-message-timestamp]';

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

export function startScrollAnchoring(): () => void {
  if (typeof CSS === 'undefined' || CSS.supports('overflow-anchor', 'auto') || typeof ResizeObserver === 'undefined') {
    return () => undefined;
  }
  const anchored = new Map<HTMLElement, () => void>();
  let frame = 0;

  const sync = () => {
    frame = 0;
    for (const [pane, stop] of anchored) {
      if (pane.isConnected) continue;
      stop();
      anchored.delete(pane);
    }
    for (const pane of document.querySelectorAll<HTMLElement>(PANE_SELECTOR)) {
      if (!anchored.has(pane)) anchored.set(pane, anchorPane(pane));
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
