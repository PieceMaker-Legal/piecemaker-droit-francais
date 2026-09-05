import { createRoot } from 'react-dom/client';

import { CitationPanel } from '@/piecemaker/citations/CitationPanel';
import { AUTH_SESSION_EXPIRED_EVENT } from '@/shared/authToken';
import '@/piecemaker/citations/citations.css';

export function startCitationPanel() {
  let host: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;
  let trigger: HTMLElement | null = null;
  const close = () => {
    root?.unmount();
    host?.remove();
    document.documentElement.classList.remove('piecemaker-citation-open');
    root = null;
    host = null;
    trigger?.focus();
  };
  const click = (event: MouseEvent) => {
    if (!(event.target instanceof Element) || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest<HTMLAnchorElement>('a[href]');
    if (!link) return;
    const href = link.getAttribute('href') ?? '';
    const match = /^#piecemaker-citation=([a-f0-9]{64})$/.exec(href);
    if (!match) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    trigger = link;
    if (!host) {
      host = document.createElement('div');
      host.id = 'piecemaker-citation-panel';
      document.body.appendChild(host);
      root = createRoot(host);
    }
    document.documentElement.classList.add('piecemaker-citation-open');
    root?.render(<CitationPanel key={match[1]} token={match[1]} onClose={close} />);
  };
  document.addEventListener('click', click, true);
  window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, close);
  window.addEventListener('popstate', close);
  return () => {
    document.removeEventListener('click', click, true);
    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, close);
    window.removeEventListener('popstate', close);
    close();
  };
}
