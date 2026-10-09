import { commandFileRefs } from '@/piecemaker/chat/commandFileRefs';
import { openInEditor } from '@/piecemaker/editor-tabs/editorPanels';

const HIGHLIGHT_NAME = 'piecemaker-command-file';
const STYLE_ELEMENT_ID = 'piecemaker-command-file-style';
const MAX_RANGES = 200;

type HighlightRegistry = {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
};

type CssWithHighlights = typeof CSS & { highlights?: HighlightRegistry };

declare const Highlight: (new (...ranges: Range[]) => unknown) | undefined;

function highlightsRegistry(): HighlightRegistry | null {
  const registry = (CSS as CssWithHighlights | undefined)?.highlights;
  return registry && typeof Highlight === 'function' ? registry : null;
}

function ensureStyleElement(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `::highlight(${HIGHLIGHT_NAME}) {
  color: rgb(0 136 255);
  text-decoration: underline;
}`;
  document.head.appendChild(style);
}

function commandTextSpans(root: ParentNode): HTMLElement[] {
  const spans: HTMLElement[] = [];
  for (const row of root.querySelectorAll('.group\\/cmd')) {
    for (const span of row.querySelectorAll('span')) {
      if (span.textContent?.trim() !== '$') continue;
      const next = span.nextElementSibling;
      if (next instanceof HTMLElement && next.tagName === 'SPAN') spans.push(next);
      break;
    }
  }
  return spans;
}

function collectRanges(root: ParentNode): Range[] {
  const ranges: Range[] = [];
  for (const span of commandTextSpans(root)) {
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && ranges.length < MAX_RANGES) {
      const text = node.nodeValue ?? '';
      for (const ref of commandFileRefs(text)) {
        if (ranges.length >= MAX_RANGES) break;
        const range = document.createRange();
        range.setStart(node, ref.start);
        range.setEnd(node, ref.end);
        ranges.push(range);
      }
      node = walker.nextNode();
    }
  }
  return ranges;
}

function pointIn(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function refAt(ranges: Range[], x: number, y: number): string | null {
  for (const range of ranges) {
    const host = range.startContainer.parentElement;
    if (!host) continue;
    if (!pointIn(host.getBoundingClientRect(), x, y)) continue;
    const hit = Array.from(range.getClientRects()).some((rect) => pointIn(rect, x, y));
    if (hit) return range.toString();
  }
  return null;
}

function publish(ranges: Range[]): void {
  const registry = highlightsRegistry();
  if (!registry) return;
  if (ranges.length === 0) {
    registry.delete(HIGHLIGHT_NAME);
    return;
  }
  const HighlightCtor = Highlight as new (...items: Range[]) => unknown;
  registry.set(HIGHLIGHT_NAME, new HighlightCtor(...ranges));
}

/**
 * Souligne les chemins d'une commande Bash et les ouvre dans l'éditeur.
 * Amorcé par le bootstrap PieceMaker. Aucun nœud n'est inséré : le texte
 * appartient à React, et un span ajouté ici casserait son prochain rendu.
 */
export function startCommandFileLinks(): () => void {
  if (typeof document === 'undefined' || !document.body) return () => {};

  let ranges: Range[] = [];
  let frame = 0;
  let hovered: HTMLElement | null = null;

  const apply = () => {
    frame = 0;
    ranges = collectRanges(document);
    publish(ranges);
  };

  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(apply);
  };

  ensureStyleElement();
  apply();

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  const onClick = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const path = refAt(ranges, event.clientX, event.clientY);
    if (!path) return;
    event.preventDefault();
    event.stopPropagation();
    openInEditor(path);
  };

  const onMove = (event: MouseEvent) => {
    const path = refAt(ranges, event.clientX, event.clientY);
    const target = event.target instanceof Element ? event.target : event.target instanceof Node ? event.target.parentElement : null;
    const span = path ? target?.closest('span') ?? null : null;
    if (hovered && hovered !== span) hovered.style.cursor = '';
    hovered = span;
    if (hovered) hovered.style.cursor = 'pointer';
  };

  document.addEventListener('click', onClick, true);
  document.addEventListener('mousemove', onMove);

  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('mousemove', onMove);
    if (hovered) hovered.style.cursor = '';
    publish([]);
    ranges = [];
  };
}
