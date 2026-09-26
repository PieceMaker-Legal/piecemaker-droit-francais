import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

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

function CitationText({ source, ranges, passage, blocks, quote }: { source: string; ranges: PassageRange[]; passage: RefObject<HTMLElement>; blocks: string[] | null; quote: string | undefined }) {
  if (!blocks) {
    return <div className="whitespace-pre-wrap break-words p-4 font-serif text-sm leading-relaxed" aria-label="Texte source">{highlightedPassage(source, 0, source.length, ranges, passage)}</div>;
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
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [blocks, setBlocks] = useState<string[] | null>(null);
  const passage = useRef<HTMLElement>(null);
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
    if (!source?.citation.decision_id) return;
    const controller = new AbortController();
    void fetchLegifranceBlocks(token, controller.signal).then((value) => {
      if (!controller.signal.aborted) setBlocks(value);
    }).catch(() => {
      if (!controller.signal.aborted) setBlocks(null);
    });
    return () => controller.abort();
  }, [token, source?.citation.decision_id]);

  useEffect(() => {
    passage.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [source, quoteIndex, blocks]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

  const quote = source?.citation.quotes[quoteIndex];
  const officialUrl = legifranceQuoteUrl(source?.citation.decision_id, quote?.quote);
  const ranges = (source?.ranges ?? []).filter((range) => range.quoteIndex === quoteIndex).sort((a, b) => a.start - b.start);

  return (
    <aside aria-label="Source de la citation" className="flex h-full min-w-0 flex-col border-l border-border bg-background text-foreground shadow-xl">
      <header className="flex items-center gap-2 border-b border-border p-3">
        <h2 className="min-w-0 flex-1 break-words text-sm font-medium">{source?.title ?? 'Source de la citation'}</h2>
        <Button ref={closeButton} variant="ghost" size="icon" aria-label="Fermer la source" onClick={onClose}><X className="h-4 w-4" /></Button>
      </header>
      {error && <p role="alert" className="p-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!error && !source && <p role="status" className="p-4 text-sm text-muted-foreground">Chargement de la source…</p>}
      {source && quote && (
        <section aria-label="Extrait cité" className="border-b border-border p-4">
          <div className="mb-2 flex items-center gap-2 text-sm">
            <span className="flex-1">Citation [{source.citation.ref}] · extrait {quoteIndex + 1}/{source.citation.quotes.length}</span>
            <Button variant="ghost" size="icon" aria-label="Extrait précédent" disabled={quoteIndex === 0} onClick={() => setQuoteIndex(quoteIndex - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" aria-label="Extrait suivant" disabled={quoteIndex + 1 >= source.citation.quotes.length} onClick={() => setQuoteIndex(quoteIndex + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <blockquote className="whitespace-pre-wrap text-sm">{quote.quote.split('[[PAGE_BREAK]]').join('…')}</blockquote>
          {(quote.page || quote.sheet || quote.cell) && <p className="mt-2 text-xs text-muted-foreground">{quote.sheet ? `${quote.sheet}${quote.cell ? ` · ${quote.cell}` : ''}` : `Page ${quote.page}`}</p>}
          {source.sourceOrigin === 'decision-cache' && <p role="status" className="mt-2 text-sm text-muted-foreground">Décision ouverte depuis le cache local. {ranges.length ? 'Passage retrouvé dans cette copie.' : 'Passage non retrouvé dans cette copie.'} La citation reste non vérifiée lors de la réponse.</p>}
          {source.sourceOrigin !== 'decision-cache' && quote.verification?.verified === false && <p role="status" className="mt-2 text-sm text-red-600 dark:text-red-400">Extrait non retrouvé dans la source. Vérifiez l’affirmation avant de vous y fier.</p>}
          {officialUrl && <a href={officialUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="mt-3 inline-block text-sm text-blue-600 underline dark:text-blue-400">Ouvrir ce passage sur Légifrance ↗</a>}
        </section>
      )}
      {source && <ScrollArea className="min-h-0 flex-1">{source.source || blocks ? <CitationText source={source.source} ranges={ranges} passage={passage} blocks={blocks} quote={quote?.quote} /> : <div className="p-4 text-sm" aria-label="Texte source">Le texte de cette source n’a pas été lu dans ce tour ou est indisponible.</div>}</ScrollArea>}
    </aside>
  );
}
