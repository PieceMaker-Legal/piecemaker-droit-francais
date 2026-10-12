import { escapeHtml } from './dom.js';

export type Drawer = { element: HTMLElement; body: HTMLElement; close(): void };

export function openDrawer(root: HTMLElement, title: string, onClose: () => void = () => {}): Drawer {
  root.querySelector('.ptr-drawer-backdrop')?.dispatchEvent(new Event('ptr-close'));
  const backdrop = document.createElement('div');
  backdrop.className = 'ptr-drawer-backdrop';
  backdrop.innerHTML = `
    <aside class="ptr-drawer" role="dialog" aria-label="${escapeHtml(title)}">
      <header class="ptr-drawer-header"><h2>${escapeHtml(title)}</h2><button type="button" class="ptr-icon-button" data-drawer-close aria-label="Fermer">×</button></header>
      <div class="ptr-drawer-body"></div>
    </aside>`;
  const element = backdrop.querySelector<HTMLElement>('.ptr-drawer')!;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !root.querySelector('.ptr-overlay')) close();
  };
  backdrop.addEventListener('ptr-close', close);
  backdrop.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target === backdrop || target.closest('[data-drawer-close]')) close();
  });
  document.addEventListener('keydown', onKey);
  root.appendChild(backdrop);
  return { element, body: element.querySelector<HTMLElement>('.ptr-drawer-body')!, close };
}
