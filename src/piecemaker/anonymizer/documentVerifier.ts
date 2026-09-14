type HighlightRegistry = {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
};

type CssWithHighlights = typeof CSS & {
  highlights?: HighlightRegistry;
};

type DocumentVerificationRequest = {
  path: string;
  people: string[];
  facts: string[];
};

type TextSegment = {
  node: Text;
  start: number;
  end: number;
};

declare const Highlight: (new (...ranges: Range[]) => unknown) | undefined;

const DOCUMENT_VERIFICATION_EVENT = 'piecemaker:verify-document';
const PERSON_HIGHLIGHT_NAME = 'piecemaker-document-person';
const FACT_HIGHLIGHT_NAME = 'piecemaker-document-fact';
const STYLE_ELEMENT_ID = 'piecemaker-document-verification-style';
const MAX_RANGES = 2000;

function uniqueValues(values: string[]): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const trimmed = value.trim();
    const key = trimmed.toLocaleLowerCase('fr');
    if (trimmed.length < 2 || seen.has(key)) return [];
    seen.add(key);
    return [trimmed];
  }).sort((left, right) => right.length - left.length);
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
}

export function buildDocumentValueRegex(values: string[]): RegExp | null {
  const usableValues = uniqueValues(values);
  if (usableValues.length === 0) return null;
  return new RegExp(usableValues.map(escapeForRegex).join('|'), 'giu');
}

export function documentDateVariants(dateIso: string | null, displayedDate: string | null): string[] {
  const variants = displayedDate ? [displayedDate] : [];
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso ?? '');
  if (!match) return uniqueValues(variants);
  const [, year, month, day] = match;
  const date = new Date(`${dateIso}T00:00:00`);
  return uniqueValues([
    ...variants,
    dateIso ?? '',
    `${day}/${month}/${year}`,
    `${day}.${month}.${year}`,
    `${day}-${month}-${year}`,
    date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
  ]);
}

function ensureStyleElement(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `::highlight(${FACT_HIGHLIGHT_NAME}) { background-color: rgb(234 179 8 / 0.28); }\n::highlight(${PERSON_HIGHLIGHT_NAME}) { background-color: rgb(249 115 22 / 0.28); }`;
  document.head.appendChild(style);
}

function editorContentForPath(path: string): Element | null {
  const pathElement = [...document.querySelectorAll<HTMLElement>('[title]')]
    .find((element) => element.getAttribute('title') === path);
  if (!pathElement) return null;
  let container = pathElement.parentElement;
  while (container) {
    const content = container.querySelector('.cm-content, .prose');
    if (content) return content;
    container = container.parentElement;
  }
  return null;
}

function textSegments(root: Element): { text: string; segments: TextSegment[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segments: TextSegment[] = [];
  let text = '';
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    const value = node.nodeValue ?? '';
    segments.push({ node, start: text.length, end: text.length + value.length });
    text += value;
    current = walker.nextNode();
  }
  return { text, segments };
}

function rangesFor(root: Element, pattern: RegExp | null): Range[] {
  if (!pattern) return [];
  const blocks = root.matches('.cm-content')
    ? [...root.querySelectorAll('.cm-line')]
    : [...root.querySelectorAll('p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote')];
  const ranges: Range[] = [];
  for (const block of blocks) {
    const { text, segments } = textSegments(block);
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match && ranges.length < MAX_RANGES) {
      const start = segments.find((segment) => segment.start <= match.index && segment.end > match.index);
      const endOffset = match.index + match[0].length;
      const end = segments.find((segment) => segment.start < endOffset && segment.end >= endOffset);
      if (start && end) {
        const range = document.createRange();
        range.setStart(start.node, match.index - start.start);
        range.setEnd(end.node, endOffset - end.start);
        ranges.push(range);
      }
      match = pattern.exec(text);
    }
    if (ranges.length >= MAX_RANGES) break;
  }
  return ranges;
}

export function requestDocumentVerification(request: DocumentVerificationRequest): void {
  window.dispatchEvent(new CustomEvent<DocumentVerificationRequest>(DOCUMENT_VERIFICATION_EVENT, { detail: request }));
}

export function startDocumentVerificationHighlighting(): () => void {
  const registry = (CSS as CssWithHighlights | undefined)?.highlights;
  if (!registry || typeof Highlight !== 'function') return () => {};
  ensureStyleElement();
  let request: DocumentVerificationRequest | null = null;
  let frame = 0;

  const apply = () => {
    frame = 0;
    if (!request) return;
    const root = editorContentForPath(request.path);
    if (!root) {
      registry.delete(PERSON_HIGHLIGHT_NAME);
      registry.delete(FACT_HIGHLIGHT_NAME);
      return;
    }
    const HighlightConstructor = Highlight as new (...ranges: Range[]) => unknown;
    const factRanges = rangesFor(root, buildDocumentValueRegex(request.facts));
    const personRanges = rangesFor(root, buildDocumentValueRegex(request.people));
    factRanges.length
      ? registry.set(FACT_HIGHLIGHT_NAME, new HighlightConstructor(...factRanges))
      : registry.delete(FACT_HIGHLIGHT_NAME);
    personRanges.length
      ? registry.set(PERSON_HIGHLIGHT_NAME, new HighlightConstructor(...personRanges))
      : registry.delete(PERSON_HIGHLIGHT_NAME);
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(apply);
  };

  const handleRequest = (event: Event) => {
    request = (event as CustomEvent<DocumentVerificationRequest>).detail;
    schedule();
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener(DOCUMENT_VERIFICATION_EVENT, handleRequest);

  return () => {
    observer.disconnect();
    window.removeEventListener(DOCUMENT_VERIFICATION_EVENT, handleRequest);
    if (frame) cancelAnimationFrame(frame);
    registry.delete(PERSON_HIGHLIGHT_NAME);
    registry.delete(FACT_HIGHLIGHT_NAME);
  };
}
