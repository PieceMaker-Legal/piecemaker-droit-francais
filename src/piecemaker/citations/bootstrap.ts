import { citationPath, openInEditor } from '@/piecemaker/editor-tabs/editorPanels';
import '@/piecemaker/citations/citations.css';

export function startCitationPanel() {
  const click = (event: MouseEvent) => {
    if (!(event.target instanceof Element) || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest<HTMLAnchorElement>('a[href]');
    if (!link) return;
    const match = /^#piecemaker-citation=([a-f0-9]{64})$/.exec(link.getAttribute('href') ?? '');
    if (!match) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const reference = link.textContent?.trim();
    openInEditor(citationPath(match[1], reference ? `Citation ${reference}` : 'Citation'));
  };
  document.addEventListener('click', click, true);
  return () => document.removeEventListener('click', click, true);
}
