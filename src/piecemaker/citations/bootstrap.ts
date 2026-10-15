import { resolvePieceRef } from '@/piecemaker/chat/fileRef';
import { fetchCitationSource } from '@/piecemaker/citations/api';
import { citationPath, openInEditor } from '@/piecemaker/editor-tabs/editorPanels';
import '@/piecemaker/citations/citations.css';

function fileCitationPath(source: Awaited<ReturnType<typeof fetchCitationSource>>) {
  const docId = source.citation.doc_id;
  if (!docId || source.citation.kind === 'case' || source.citation.kind === 'article') return null;
  return docId;
}

function citationQuote(source: Awaited<ReturnType<typeof fetchCitationSource>>) {
  const quotes = source.citation.quotes;
  const chosen = quotes.find((quote) => quote.verification?.verified) ?? quotes[0];
  if (!chosen?.quote) return undefined;
  const page = typeof chosen.page === 'number' ? chosen.page : Number(chosen.page);
  return {
    quote: chosen.quote,
    page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : undefined,
  };
}

async function openCitation(source: Awaited<ReturnType<typeof fetchCitationSource>>, token: string, label: string) {
  const filePath = fileCitationPath(source);
  const passage = citationQuote(source);
  if (!filePath) {
    openInEditor(citationPath(token, label));
    return;
  }
  if (source.citation.kind === 'document') {
    const path = await resolvePieceRef(filePath) ?? citationPath(token, label);
    openInEditor(path, path.startsWith('piecemaker://') ? undefined : passage);
    return;
  }
  openInEditor(filePath, passage);
}

export function startCitationPanel() {
  const click = (event: MouseEvent) => {
    if (!(event.target instanceof Element) || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest<HTMLAnchorElement>('a[href]');
    if (!link) return;
    const match = /^#piecemaker-citation=([a-f0-9]{64})$/.exec(link.getAttribute('href') ?? '');
    if (!match) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const token = match[1];
    const reference = link.textContent?.trim();
    const label = reference ? `Citation ${reference}` : 'Citation';
    void fetchCitationSource(token, new AbortController().signal).then((source) => {
      void openCitation(source, token, label);
    }).catch(() => {
      openInEditor(citationPath(token, label));
    });
  };
  document.addEventListener('click', click, true);
  return () => document.removeEventListener('click', click, true);
}
