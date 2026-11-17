const PICK_REQUEST_EVENT = 'piecemaker:panel-pick';
const PICK_STATE_EVENT = 'piecemaker:panel-pick-state';
const PICKED_EVENT = 'piecemaker:panel-picked';
const CHAT_PICK_EVENT = 'piecemaker:chat-pick';
const PICKING_CLASS = 'pmc-picking';

const STYLES = `
.${PICKING_CLASS} [data-chat-tab] [data-chat-pick]{cursor:crosshair;outline:1px dashed hsl(var(--primary) / .5);outline-offset:2px}
.${PICKING_CLASS} [data-chat-tab] [data-chat-pick]:hover{outline:2px solid hsl(var(--primary))}
`;

const targetsOf = (tab: string) => `[data-chat-tab=${JSON.stringify(tab)}] [data-chat-pick]`;
const lineOf = (value?: string) => {
  const line = Number(value);
  return Number.isInteger(line) && line > 0 ? line : undefined;
};

export function chatPickOf(element: HTMLElement) {
  const { chatPick, chatKind, chatFile, chatLine, chatEnd, chatNote } = element.dataset;
  return { titre: chatPick?.trim() || '', nature: chatKind || undefined, fichier: chatFile || undefined, debut: lineOf(chatLine), fin: lineOf(chatEnd), note: chatNote || undefined };
}

export function startPanelPicker(): () => void {
  let tab = '';
  const style = document.createElement('style');
  style.textContent = STYLES;
  document.head.append(style);

  const announce = (name: string, active: boolean) => window.dispatchEvent(new CustomEvent(PICK_STATE_EVENT, { detail: { tab: name, active } }));
  const stop = () => {
    if (!tab) return;
    const previous = tab;
    tab = '';
    document.documentElement.classList.remove(PICKING_CLASS);
    announce(previous, false);
  };
  const request = (event: Event) => {
    const requested = (event as CustomEvent<{ tab?: string }>).detail?.tab;
    if (!requested) return;
    if (tab === requested) return stop();
    if (!document.querySelector(targetsOf(requested))) return;
    stop();
    tab = requested;
    document.documentElement.classList.add(PICKING_CLASS);
    announce(tab, true);
  };
  const click = (event: MouseEvent) => {
    if (!tab) return;
    const target = (event.target as Element | null)?.closest<HTMLElement>('[data-chat-pick]');
    if (!target?.matches(targetsOf(tab))) return;
    const pick = chatPickOf(target);
    if (!pick.titre) return;
    event.preventDefault();
    event.stopPropagation();
    const picked = tab;
    stop();
    window.dispatchEvent(new CustomEvent(CHAT_PICK_EVENT, { detail: { ...pick, tab: picked } }));
    window.dispatchEvent(new CustomEvent(PICKED_EVENT, { detail: { tab: picked } }));
  };
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') stop(); };

  window.addEventListener(PICK_REQUEST_EVENT, request);
  window.addEventListener('click', click, true);
  window.addEventListener('keydown', escape);
  return () => {
    stop();
    window.removeEventListener(PICK_REQUEST_EVENT, request);
    window.removeEventListener('click', click, true);
    window.removeEventListener('keydown', escape);
    style.remove();
  };
}
