import { HIGHLIGHT_NAME } from '@/piecemaker/anonymizer/highlighter';

type HighlightLookup = {
  get(name: string): Iterable<AbstractRange> | undefined;
};

const IDENTITY_OPEN_EVENT = 'piecemaker:identity-open';
const IDENTITY_ADD_EVENT = 'piecemaker:identity-add';
export const IDENTITY_CHANGED_EVENT = 'piecemaker:identity-changed';

const SCOPE_SELECTOR = '.chat-messages-pane, [data-piecemaker-identity-highlight="on"]';
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

function selectionInScope(): string | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = selection.toString().replace(/\s+/g, ' ').trim();
  if (text.length < 2) return null;
  const container = selection.getRangeAt(0).commonAncestorContainer;
  const element = container instanceof Element ? container : container.parentElement;
  return element?.closest(SCOPE_SELECTOR) ? text : null;
}

function closeMenu(): void {
  document.getElementById(MENU_ID)?.remove();
}

function openMenu(x: number, y: number, text: string): void {
  closeMenu();
  const menu = document.createElement('div');
  menu.id = MENU_ID;
  menu.setAttribute('role', 'menu');
  menu.className = 'fixed z-[80] min-w-[180px] rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg';
  menu.style.left = `${Math.min(x, window.innerWidth - 200)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 48)}px`;
  const item = document.createElement('button');
  item.type = 'button';
  item.setAttribute('role', 'menuitem');
  item.className = 'w-full rounded-md px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground';
  item.textContent = 'Ajouter au mapping';
  item.addEventListener('click', () => {
    closeMenu();
    window.dispatchEvent(new CustomEvent(IDENTITY_ADD_EVENT, { detail: { text } }));
  });
  menu.appendChild(item);
  document.body.appendChild(menu);
  item.focus();
}

export function startIdentityInteractions(): () => void {
  let frame = 0;
  let pointer: { x: number; y: number; target: EventTarget | null } | null = null;
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
    window.dispatchEvent(new CustomEvent(IDENTITY_OPEN_EVENT, { detail: { text } }));
  };

  const contextMenu = (event: MouseEvent) => {
    if (!scopeOf(event.target)) return;
    const text = selectionInScope();
    if (!text) return;
    event.preventDefault();
    openMenu(event.clientX, event.clientY, text);
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
  };

  const move = (event: MouseEvent) => {
    pointer = { x: event.clientX, y: event.clientY, target: event.target };
    if (!frame) frame = requestAnimationFrame(paintCursor);
  };

  const dismiss = (event: Event) => {
    if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
    if (event.target instanceof Node && document.getElementById(MENU_ID)?.contains(event.target)) return;
    closeMenu();
  };

  document.addEventListener('click', click);
  document.addEventListener('contextmenu', contextMenu);
  document.addEventListener('mousemove', move, { passive: true });
  document.addEventListener('mousedown', dismiss, true);
  document.addEventListener('keydown', dismiss);
  window.addEventListener('blur', closeMenu);
  window.addEventListener('scroll', closeMenu, true);

  return () => {
    document.removeEventListener('click', click);
    document.removeEventListener('contextmenu', contextMenu);
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mousedown', dismiss, true);
    document.removeEventListener('keydown', dismiss);
    window.removeEventListener('blur', closeMenu);
    window.removeEventListener('scroll', closeMenu, true);
    if (frame) cancelAnimationFrame(frame);
    if (hovered) hovered.style.cursor = '';
    closeMenu();
  };
}
