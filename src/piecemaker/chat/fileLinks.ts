import { commandFileRefs } from '@/piecemaker/chat/commandFileRefs';
import { cachedFileRef, resolveFileRef } from '@/piecemaker/chat/fileRef';
import { openInEditor } from '@/piecemaker/editor-tabs/editorPanels';

const HIGHLIGHT_NAME = 'piecemaker-command-file';
const STYLE_ELEMENT_ID = 'piecemaker-file-links-style';
const MAX_RANGES = 200;
// Le Markdown du chat n'ouvre dans un nouvel onglet (`target`) que les liens
// externes : un lien sans `target` dans `.prose` est une citation de fichier.
const FILE_ANCHOR = '.prose a[href]:not([target])';
const UNVERIFIED = `${FILE_ANCHOR}:not([data-pm-file="ok"])`;

type HighlightRegistry = {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
};

type CssWithHighlights = typeof CSS & { highlights?: HighlightRegistry };

type CommandLink = { range: Range; ref: string };

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
}
${UNVERIFIED}, ${UNVERIFIED} code {
  color: inherit !important;
  cursor: text !important;
  text-decoration: none !important;
}`;
  document.head.appendChild(style);
}

function anchorRef(anchor: Element): string {
  const href = anchor.getAttribute('href') ?? '';
  try {
    return decodeURI(href);
  } catch {
    return href;
  }
}

/**
 * Pose `data-pm-file` sur chaque lien de fichier du Markdown : `ok` seulement
 * quand le serveur a trouvé le fichier. Sans cet état, la feuille de style le
 * rend comme du texte. React ne gère pas cet attribut : il le laisse en place.
 */
function markAnchors(root: ParentNode, onResolved: () => void): void {
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>(FILE_ANCHOR)) {
    const ref = anchorRef(anchor);
    const target = ref ? cachedFileRef(ref) : null;
    if (target === undefined) {
      anchor.dataset.pmFile = 'pending';
      void resolveFileRef(ref).then(onResolved);
    } else if (target) {
      anchor.dataset.pmFile = 'ok';
    } else {
      anchor.dataset.pmFile = 'none';
    }
  }
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

/** Plages des chemins d'une commande Bash dont le fichier existe. */
function collectCommandLinks(root: ParentNode, onResolved: () => void): CommandLink[] {
  const links: CommandLink[] = [];
  for (const span of commandTextSpans(root)) {
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && links.length < MAX_RANGES) {
      for (const ref of commandFileRefs(node.nodeValue ?? '')) {
        if (links.length >= MAX_RANGES) break;
        const target = cachedFileRef(ref.path);
        if (target === undefined) void resolveFileRef(ref.path).then(onResolved);
        if (!target) continue;
        const range = document.createRange();
        range.setStart(node, ref.start);
        range.setEnd(node, ref.end);
        links.push({ range, ref: ref.path });
      }
      node = walker.nextNode();
    }
  }
  return links;
}

function pointIn(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function commandRefAt(links: CommandLink[], x: number, y: number): string | null {
  for (const { range, ref } of links) {
    const host = range.startContainer.parentElement;
    if (!host) continue;
    if (!pointIn(host.getBoundingClientRect(), x, y)) continue;
    const hit = Array.from(range.getClientRects()).some((rect) => pointIn(rect, x, y));
    if (hit) return ref;
  }
  return null;
}

function publish(links: CommandLink[]): void {
  const registry = highlightsRegistry();
  if (!registry) return;
  if (links.length === 0) {
    registry.delete(HIGHLIGHT_NAME);
    return;
  }
  const HighlightCtor = Highlight as new (...items: Range[]) => unknown;
  registry.set(HIGHLIGHT_NAME, new HighlightCtor(...links.map((link) => link.range)));
}

function closestFileAnchor(target: EventTarget | null): HTMLAnchorElement | null {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return element?.closest<HTMLAnchorElement>(FILE_ANCHOR) ?? null;
}

/**
 * Liens de fichiers du chat, sur le modèle des liens fichier de VS Code : un
 * chemin cité (Markdown ou commande Bash) n'est cliquable qu'après que le
 * serveur a vérifié le fichier, et le clic revérifie avant d'ouvrir le chemin
 * réel. Amorcé par le bootstrap PieceMaker. Aucun nœud n'est inséré ni retiré :
 * le texte appartient à React.
 */
export function startFileLinks(): () => void {
  if (typeof document === 'undefined' || !document.body) return () => {};

  let commandLinks: CommandLink[] = [];
  let frame = 0;
  let hovered: HTMLElement | null = null;

  const apply = () => {
    frame = 0;
    markAnchors(document, schedule);
    commandLinks = collectCommandLinks(document, schedule);
    publish(commandLinks);
  };

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(apply);
  }

  const open = async (ref: string) => {
    const path = await resolveFileRef(ref, { fresh: true });
    if (path) openInEditor(path);
    schedule();
  };

  ensureStyleElement();
  apply();

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  // Capture : passe avant le `onClick` React du lien, qui ouvrirait le texte brut.
  const onClick = (event: MouseEvent) => {
    const anchor = closestFileAnchor(event.target);
    if (anchor) {
      event.preventDefault();
      event.stopPropagation();
      if (event.type === 'click' && anchor.dataset.pmFile === 'ok') void open(anchorRef(anchor));
      return;
    }
    if (event.type !== 'click' || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const ref = commandRefAt(commandLinks, event.clientX, event.clientY);
    if (!ref) return;
    event.preventDefault();
    event.stopPropagation();
    void open(ref);
  };

  const onMove = (event: MouseEvent) => {
    const ref = commandRefAt(commandLinks, event.clientX, event.clientY);
    const target = event.target instanceof Element ? event.target : event.target instanceof Node ? event.target.parentElement : null;
    const span = ref ? target?.closest('span') ?? null : null;
    if (hovered && hovered !== span) hovered.style.cursor = '';
    hovered = span;
    if (hovered) hovered.style.cursor = 'pointer';
  };

  document.addEventListener('click', onClick, true);
  document.addEventListener('auxclick', onClick, true);
  document.addEventListener('mousemove', onMove);

  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('auxclick', onClick, true);
    document.removeEventListener('mousemove', onMove);
    if (hovered) hovered.style.cursor = '';
    publish([]);
    commandLinks = [];
  };
}
