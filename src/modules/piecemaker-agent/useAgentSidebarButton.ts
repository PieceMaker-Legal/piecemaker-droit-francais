import { useEffect } from 'react';

export const AGENT_OPEN_EVENT = 'piecemaker:agent-open';

const MARKER = 'piecemakerAgent';
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>';

function newSessionButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLElement>('div.ml-3.space-y-1.border-l')]
    .map((container) => container.querySelector<SVGElement>('.lucide-plus')?.closest<HTMLButtonElement>('button') ?? null)
    .filter((button): button is HTMLButtonElement => Boolean(button));
}

function projectPath(button: HTMLButtonElement): string | null {
  const item = button.closest<HTMLElement>('div.ml-3.space-y-1.border-l')?.parentElement;
  const title = item?.dataset.piecemakerProjectPath ?? item?.querySelector<HTMLElement>('.min-w-0.flex-1.text-left[title]')?.title ?? '';
  return /^([a-zA-Z]:[\\/]|\/)/.test(title) ? title : null;
}

function anchor(button: HTMLButtonElement): HTMLElement {
  const wrapper = button.parentElement;
  return wrapper?.matches('.px-3.pb-1.pt-1') ? wrapper : button;
}

export function openAgent(path: string, sessionButton: HTMLButtonElement) {
  sessionButton.click();
  window.requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(AGENT_OPEN_EVENT, { detail: { project: path } })));
}

function render() {
  for (const sessionButton of newSessionButtons()) {
    const path = projectPath(sessionButton);
    if (!path) continue;
    const reference = anchor(sessionButton);
    const previous = reference.previousElementSibling as HTMLElement | null;
    if (previous?.dataset[MARKER] === path) continue;
    if (previous?.dataset[MARKER]) previous.remove();
    const wrapper = document.createElement('div');
    wrapper.dataset[MARKER] = path;
    if (reference !== sessionButton) wrapper.className = reference.className;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = sessionButton.className;
    button.title = 'Ouvrir PieceMaker Agent pour ce dossier';
    button.innerHTML = `${ICON}<span>PieceMaker Agent</span>`;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openAgent(path, sessionButton);
    });
    wrapper.appendChild(button);
    reference.insertAdjacentElement('beforebegin', wrapper);
  }
}

export function useAgentSidebarButton() {
  useEffect(() => {
    let frame = 0;
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(() => { frame = 0; render(); }); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    render();
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      document.querySelectorAll('[data-piecemaker-agent]').forEach((element) => element.remove());
    };
  }, []);
}
