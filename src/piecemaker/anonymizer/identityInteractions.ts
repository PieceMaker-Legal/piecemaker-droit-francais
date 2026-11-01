import { HIGHLIGHT_NAME } from '@/piecemaker/anonymizer/highlighter';
import { chatSessionId, startSideConversation } from '@/piecemaker/chat/sideConversation';
import { identityPath, openInEditor } from '@/piecemaker/editor-tabs/editorPanels';

type HighlightLookup = {
  get(name: string): Iterable<AbstractRange> | undefined;
};

export const IDENTITY_CHANGED_EVENT = 'piecemaker:identity-changed';

const CHAT_SELECTOR = '.chat-messages-pane';
const SCOPE_SELECTOR = `${CHAT_SELECTOR}, [data-piecemaker-identity-highlight="on"]`;
const MENU_ID = 'piecemaker-identity-menu';

function highlightedIdentityAt(x: number, y: number): string | null {
  const ranges = (CSS as typeof CSS & { highlights?: HighlightLookup }).highlights?.get(HIGHLIGHT_NAME);
  if (!ranges) return null;
  for (const range of ranges) {
    if (!(range instanceof Range)) continue;
    const hit = Array.from(range.getClientRects()).some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
    if (hit) return range.toString();
  }
  return null;
}

type ScreenRect = { left: number; right: number; top: number; bottom: number };

type ScopedSelection = { text: string; range: Range; element: Element };

const MENU_GAP = 4;
const HOVER_MARGIN = 6;

function selectionInScope(): ScopedSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = selection.toString().replace(/\s+/g, ' ').trim();
  if (text.length < 2) return null;
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const element = container instanceof Element ? container : container.parentElement;
  return element?.closest(SCOPE_SELECTOR) ? { text, range, element } : null;
}

function closeMenu(): void {
  document.getElementById(MENU_ID)?.remove();
}

function menuItem(label: string, onSelect: () => void): HTMLButtonElement {
  const item = document.createElement('button');
  item.type = 'button';
  item.setAttribute('role', 'menuitem');
  item.className = 'rounded-md px-2 py-1 hover:bg-accent hover:text-accent-foreground';
  item.textContent = label;
  item.addEventListener('click', () => {
    closeMenu();
    window.getSelection()?.removeAllRanges();
    onSelect();
  });
  return item;
}

function openMenu({ text, range, element }: ScopedSelection): void {
  closeMenu();
  const menu = document.createElement('div');
  menu.id = MENU_ID;
  menu.setAttribute('role', 'menu');
  menu.className = 'fixed z-[80] flex items-center gap-1 whitespace-nowrap rounded-lg border border-border bg-popover p-1 text-xs text-popover-foreground shadow-lg';
  const chat = element.closest(CHAT_SELECTOR);
  const sessionId = chat ? chatSessionId(chat) : null;
  if (sessionId) {
    menu.appendChild(menuItem('Démarrer une conversation annexe', () => void startSideConversation(sessionId, text)));
  }
  menu.appendChild(menuItem('Anonymiser', () => openInEditor(identityPath('add', text))));
  document.body.appendChild(menu);
  const selected = range.getBoundingClientRect();
  menu.style.left = `${Math.max(0, Math.min(selected.left, window.innerWidth - menu.offsetWidth))}px`;
  menu.style.top = `${Math.max(0, selected.top - menu.offsetHeight - MENU_GAP)}px`;
}

function isNear(rect: ScreenRect, x: number, y: number, margin: number): boolean {
  return x >= rect.left - margin && x <= rect.right + margin && y >= rect.top - margin && y <= rect.bottom + margin;
}

function paintSelectionMenu(x: number, y: number): void {
  const menu = document.getElementById(MENU_ID);
  const selection = selectionInScope();
  if (menu) {
    if (isNear(menu.getBoundingClientRect(), x, y, HOVER_MARGIN)) return;
    if (selection && isNear(selection.range.getBoundingClientRect(), x, y, HOVER_MARGIN)) return;
    closeMenu();
  }
  if (selection && Array.from(selection.range.getClientRects()).some((rect) => isNear(rect, x, y, 0))) openMenu(selection);
}

export function startIdentityInteractions(): () => void {
  let frame = 0;
  let pointer: { x: number; y: number; target: EventTarget | null; pressed: boolean } | null = null;
  let hovered: HTMLElement | null = null;

  const scopeOf = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>(SCOPE_SELECTOR) : null;

  const click = (event: MouseEvent) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (!scopeOf(event.target) || (event.target instanceof Element && event.target.closest('a[href], button'))) return;
    if (selectionInScope()) return;
    const text = highlightedIdentityAt(event.clientX, event.clientY);
    if (!text) return;
    event.preventDefault();
    openInEditor(identityPath('open', text));
  };

  const paintCursor = () => {
    frame = 0;
    if (!pointer) return;
    const scope = scopeOf(pointer.target);
    const over = Boolean(scope && highlightedIdentityAt(pointer.x, pointer.y));
    if (hovered && (hovered !== scope || !over)) {
      hovered.style.cursor = '';
      hovered = null;
    }
    if (scope && over) {
      scope.style.cursor = 'pointer';
      hovered = scope;
    }
    if (!pointer.pressed) paintSelectionMenu(pointer.x, pointer.y);
  };

  const move = (event: MouseEvent) => {
    pointer = { x: event.clientX, y: event.clientY, target: event.target, pressed: event.buttons !== 0 };
    if (!frame) frame = requestAnimationFrame(paintCursor);
  };

  const dismiss = (event: Event) => {
    if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
    if (event.target instanceof Node && document.getElementById(MENU_ID)?.contains(event.target)) return;
    closeMenu();
  };

  document.addEventListener('click', click);
  document.addEventListener('mousemove', move, { passive: true });
  document.addEventListener('mouseup', move);
  document.addEventListener('mousedown', dismiss, true);
  document.addEventListener('keydown', dismiss);
  window.addEventListener('blur', closeMenu);
  window.addEventListener('scroll', closeMenu, true);

  return () => {
    document.removeEventListener('click', click);
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', move);
    document.removeEventListener('mousedown', dismiss, true);
    document.removeEventListener('keydown', dismiss);
    window.removeEventListener('blur', closeMenu);
    window.removeEventListener('scroll', closeMenu, true);
    if (frame) cancelAnimationFrame(frame);
    if (hovered) hovered.style.cursor = '';
    closeMenu();
  };
}
