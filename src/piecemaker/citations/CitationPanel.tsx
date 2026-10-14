import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ExternalLink, X } from 'lucide-react';

import { Button, ScrollArea } from '@/shared/ui';
import { fetchCitationSource, fetchLegifranceBlocks } from '@/piecemaker/citations/api';
import { legifranceQuoteUrl } from '@/piecemaker/citations/legifrance';

type PassageRange = { start: number; end: number };

const detachedPassage: RefObject<HTMLElement> = { current: null };

function quoteRanges(block: string, quote: string | undefined) {
  if (!quote) return [];
  const ranges: PassageRange[] = [];
  for (const part of quote.split(/\[\[PAGE_BREAK\]\]|\.{3}|…/).map((item) => item.trim()).filter(Boolean)) {
    const pattern = part.split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
    const match = pattern ? new RegExp(pattern).exec(block) : null;
    if (match) ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

function highlightedPassage(source: string, start: number, end: number, ranges: PassageRange[], passage: RefObject<HTMLElement>) {
  const parts: ReactNode[] = [];
  let offset = start;
  for (const [index, range] of ranges.entries()) {
    const from = Math.max(range.start, start);
    const to = Math.min(range.end, end);
    if (range.end > source.length || range.end <= range.start || from < offset || to <= from) continue;
    if (from > offset) parts.push(source.slice(offset, from));
    parts.push(<mark key={`${range.start}-${range.end}`} ref={index === 0 && from === range.start ? passage : undefined} className="rounded bg-yellow-200 text-gray-950 dark:bg-yellow-700 dark:text-white">{source.slice(from, to)}</mark>);
    offset = to;
  }
  if (offset < end) parts.push(source.slice(offset, end));
  return parts;
}

function CitationText({ source, ranges, passage, blocks, quote, code }: { source: string; ranges: PassageRange[]; passage: RefObject<HTMLElement>; blocks: string[] | null; quote: string | undefined; code: boolean }) {
  if (!blocks) {
    return <div className={`whitespace-pre-wrap break-words p-4 leading-relaxed ${code ? 'font-mono text-xs' : 'font-serif text-sm'}`} aria-label="Texte source">{highlightedPassage(source, 0, source.length, ranges, passage)}</div>;
  }
  const firstMarked = blocks.findIndex((block) => quoteRanges(block, quote).length > 0);
  return (
    <div className="piecemaker-decision" lang="fr" aria-label="Texte source">
      {blocks.map((block, index) => (
        <p key={index}>
          {highlightedPassage(block, 0, block.length, quoteRanges(block, quote), index === firstMarked ? passage : detachedPassage)}
        </p>
      ))}
    </div>
  );
}

export function CitationPanel({ token, onClose }: { token: string; onClose: () => void }) {
  return <CitationPanelContent key={token} token={token} onClose={onClose} />;
}

function CitationPanelContent({ token, onClose }: { token: string; onClose: () => void }) {
  const [source, setSource] = useState<Awaited<ReturnType<typeof fetchCitationSource>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<string[] | null>(null);
  const passage = useRef<HTMLElement>(null);
  const lawId = source?.citation.decision_id ?? source?.citation.article_id;
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    closeButton.current?.focus();
    void fetchCitationSource(token, controller.signal).then((value) => {
      if (!controller.signal.aborted) setSource(value);
    }).catch(() => {
      if (!controller.signal.aborted) setError('La source de cette citation est indisponible.');
    });
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    if (!lawId) return;
    const controller = new AbortController();
    void fetchLegifranceBlocks(token, controller.signal).then((value) => {
      if (!controller.signal.aborted) setBlocks(value);
    }).catch(() => {
      if (!controller.signal.aborted) setBlocks(null);
    });
    return () => controller.abort();
  }, [token, lawId]);

  useEffect(() => {
    passage.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [source, blocks]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

  const quote = source?.citation.quotes[0];
  const officialUrl = legifranceQuoteUrl(lawId, quote?.quote);
  const ranges = (source?.ranges ?? []).filter((range) => range.quoteIndex === 0).sort((a, b) => a.start - b.start);

  return (
    <aside aria-label="Source de la citation" className="flex h-full min-w-0 flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 border-b border-border p-3">
        <h2 className="min-w-0 flex-1 break-words text-sm font-medium">{source?.title ?? 'Source de la citation'}</h2>
        {officialUrl && <a href={officialUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label="Ouvrir la source sur Légifrance" className="shrink-0 text-blue-600 dark:text-blue-400"><ExternalLink className="h-4 w-4" /></a>}
        <Button ref={closeButton} variant="ghost" size="icon" aria-label="Fermer la source" onClick={onClose}><X className="h-4 w-4" /></Button>
      </header>
      {error && <p role="alert" className="p-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!error && !source && <p role="status" className="p-4 text-sm text-muted-foreground">Chargement de la source…</p>}
      {source && <ScrollArea className="min-h-0 flex-1">{source.source || blocks ? <CitationText source={source.source} ranges={ranges} passage={passage} blocks={blocks} quote={quote?.quote} code={source.citation.kind === 'code'} /> : <div className="p-4 text-sm" aria-label="Texte source">Le texte de cette source n’a pas été lu dans ce tour ou est indisponible.</div>}</ScrollArea>}
      {source && quote && <section aria-label="Extrait cité" className="border-t border-border px-4 py-3 text-sm"><span className="whitespace-nowrap">Citation 1/{source.citation.quotes.length}</span></section>}
    </aside>
  );
}
