/**
 * Surlignage orange des identités protégées dans l'interface.
 *
 * Le texte affiché contient déjà les vrais noms : le proxy PII a dé-anonymisé la
 * réponse avant qu'elle n'arrive. Il ne reste qu'à signaler à l'utilisateur
 * quelles portions ont voyagé sous un code.
 *
 * L'API CSS Custom Highlight est utilisée précisément parce qu'elle style du
 * texte **sans toucher au DOM** : envelopper les noms dans des `<span>` ferait
 * diverger l'arbre réel de celui que React croit avoir rendu, et le premier
 * re-rendu se solderait par un `NotFoundError: Failed to execute 'removeChild'`.
 * Ici, aucun nœud n'est créé ni déplacé — seules des `Range` sont enregistrées.
 */

type HighlightRegistry = {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
};

type CssWithHighlights = typeof CSS & {
  highlights?: HighlightRegistry;
};

declare const Highlight: (new (...ranges: Range[]) => unknown) | undefined;

const HIGHLIGHT_NAME = 'piecemaker-identity';
const STYLE_ELEMENT_ID = 'piecemaker-identity-highlight-style';
const MAX_RANGES = 4000;

/** Sous-arbres dont le texte n'a pas de sens à surligner, ou qui ne sont pas du texte. */
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'CANVAS']);

function highlightsRegistry(): HighlightRegistry | null {
  const registry = (CSS as CssWithHighlights | undefined)?.highlights;
  return registry && typeof Highlight === 'function' ? registry : null;
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Bornes Unicode plutôt que `\b` : `\b` est ASCII, il couperait « Motté » ou
 * « Nguyễn » au mauvais endroit. Le drapeau `i` fait que la casse du texte
 * affiché n'a pas à correspondre à celle du dictionnaire.
 */
export function buildNameRegex(names: string[]): RegExp | null {
  if (names.length === 0) return null;
  const alternatives = names.map(escapeForRegex).join('|');
  try {
    return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, 'giu');
  } catch {
    return null;
  }
}

function ensureStyleElement(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  // Une teinte, pas un marqueur : l'information doit se lire sans gêner la lecture.
  style.textContent = `::highlight(${HIGHLIGHT_NAME}) {
  background-color: rgb(249 115 22 / 0.18);
  border-radius: 2px;
}`;
  document.head.appendChild(style);
}

function collectRanges(root: Node, pattern: RegExp): Range[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || SKIPPED_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue || node.nodeValue.length < 2) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const ranges: Range[] = [];
  let node = walker.nextNode();
  while (node && ranges.length < MAX_RANGES) {
    const text = node.nodeValue ?? '';
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match && ranges.length < MAX_RANGES) {
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      ranges.push(range);
      match = pattern.exec(text);
    }
    node = walker.nextNode();
  }
  return ranges;
}

export type IdentityHighlighter = {
  setNames(names: string[]): void;
  refresh(): void;
  stop(): void;
};

/** Sans support navigateur, renvoie un objet inerte : l'app fonctionne à l'identique. */
export function createIdentityHighlighter(): IdentityHighlighter {
  const registry = highlightsRegistry();
  if (!registry) {
    return { setNames: () => {}, refresh: () => {}, stop: () => {} };
  }

  ensureStyleElement();

  let pattern: RegExp | null = null;
  let frame = 0;
  let observer: MutationObserver | null = null;

  const apply = () => {
    frame = 0;
    if (!pattern) {
      registry.delete(HIGHLIGHT_NAME);
      return;
    }
    const ranges = collectRanges(document.body, pattern);
    if (ranges.length === 0) {
      registry.delete(HIGHLIGHT_NAME);
      return;
    }
    const HighlightCtor = Highlight as new (...ranges: Range[]) => unknown;
    registry.set(HIGHLIGHT_NAME, new HighlightCtor(...ranges));
  };

  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(apply);
  };

  const startObserver = () => {
    if (observer) return;
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  };

  return {
    setNames(names) {
      pattern = buildNameRegex(names);
      if (pattern) startObserver();
      schedule();
    },
    refresh: schedule,
    stop() {
      observer?.disconnect();
      observer = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      registry.delete(HIGHLIGHT_NAME);
    },
  };
}

export { HIGHLIGHT_NAME };
