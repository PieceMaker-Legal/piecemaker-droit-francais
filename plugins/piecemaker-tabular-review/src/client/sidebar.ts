import { OPEN_EVENT, PENDING_TARGET_KEY } from '../shared.js';

export type InjectionHost = {
  rpc(method: string, path: string, body?: unknown): Promise<unknown>;
  openTab(): boolean;
};

const MARKER = 'piecemakerTabularReview';
const POLL_INTERVAL = 15_000;
const OPEN_ATTEMPTS = 30;

const BUTTON_STYLE = [
  'display:flex',
  'align-items:center',
  'gap:.5rem',
  'width:100%',
  'height:2rem',
  'padding:0 .75rem',
  'border:1px solid hsl(var(--border))',
  'border-radius:calc(var(--radius, .5rem) - 2px)',
  'background:hsl(var(--background))',
  'color:hsl(var(--foreground))',
  'font:500 12px/1 inherit',
  'cursor:pointer',
].join(';');

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>';

type PendingWindow = Window & { [PENDING_TARGET_KEY]?: unknown };

function newSessionButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLElement>('div.ml-3.space-y-1.border-l')]
    .map((container) => container.querySelector<SVGElement>('.lucide-plus')?.closest<HTMLButtonElement>('button') ?? null)
    .filter((button): button is HTMLButtonElement => Boolean(button));
}

function projectPath(button: HTMLButtonElement): string | null {
  const container = button.closest<HTMLElement>('div.ml-3.space-y-1.border-l');
  const title = container?.parentElement?.querySelector<HTMLElement>('.min-w-0.flex-1.text-left[title]')?.title ?? '';
  return /^([a-zA-Z]:[\\/]|\/)/.test(title) ? title : null;
}

function anchor(button: HTMLButtonElement): HTMLElement {
  const wrapper = button.parentElement;
  return wrapper?.matches('.px-3.pb-1.pt-1') ? wrapper : button;
}

export function inject(host: InjectionHost): () => void {
  let protectedProjects = new Set<string>();
  let frame = 0;
  let timer = 0;
  let stopped = false;

  function openTab(attempt = 0) {
    if (stopped || host.openTab() || attempt >= OPEN_ATTEMPTS) return;
    window.requestAnimationFrame(() => openTab(attempt + 1));
  }

  function launch(path: string, sessionButton: HTMLButtonElement) {
    (window as PendingWindow)[PENDING_TARGET_KEY] = path;
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { project: path } }));
    sessionButton.click();
    window.requestAnimationFrame(() => openTab());
  }

  function render() {
    frame = 0;
    const seen = new Set<HTMLElement>();
    for (const sessionButton of newSessionButtons()) {
      const path = projectPath(sessionButton);
      if (!path || !protectedProjects.has(path)) continue;
      const reference = anchor(sessionButton);
      const next = reference.nextElementSibling as HTMLElement | null;
      if (next?.dataset[MARKER] === path) {
        seen.add(next);
        continue;
      }
      const wrapper = document.createElement('div');
      wrapper.dataset[MARKER] = path;
      if (reference !== sessionButton) wrapper.className = reference.className;
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('style', BUTTON_STYLE);
      button.title = 'Analyser les documents Markdown de ce dossier sous forme de tableau';
      button.innerHTML = `${ICON}<span>Tabular review</span>`;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        launch(path, sessionButton);
      });
      wrapper.appendChild(button);
      reference.insertAdjacentElement('afterend', wrapper);
      seen.add(wrapper);
    }
    document.querySelectorAll<HTMLElement>('[data-piecemaker-tabular-review]').forEach((element) => {
      if (!seen.has(element)) element.remove();
    });
  }

  function schedule() {
    if (!frame && !stopped) frame = window.requestAnimationFrame(render);
  }

  async function refresh() {
    window.clearTimeout(timer);
    try {
      const result = await host.rpc('GET', '/protected-projects') as { projects?: unknown };
      const projects = Array.isArray(result?.projects) ? result.projects.filter((entry): entry is string => typeof entry === 'string') : [];
      protectedProjects = new Set(projects);
      schedule();
    } catch {
      protectedProjects = new Set();
      schedule();
    }
    if (!stopped) timer = window.setTimeout(() => void refresh(), POLL_INTERVAL);
  }

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => [...mutation.addedNodes, ...mutation.removedNodes].some((node) => !(node instanceof HTMLElement) || node.dataset[MARKER] === undefined))) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const onFocus = () => void refresh();
  window.addEventListener('focus', onFocus);
  void refresh();

  return () => {
    stopped = true;
    observer.disconnect();
    window.removeEventListener('focus', onFocus);
    window.clearTimeout(timer);
    if (frame) window.cancelAnimationFrame(frame);
    document.querySelectorAll('[data-piecemaker-tabular-review]').forEach((element) => element.remove());
  };
}
