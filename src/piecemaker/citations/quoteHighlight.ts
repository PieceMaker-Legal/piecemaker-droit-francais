import { Decoration, EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

import { locateQuotes } from '@/piecemaker/citations/locateQuote';

export function quoteHighlightExtension(content: string, quote: string | undefined): Extension {
  if (!quote) return [];
  const hits = locateQuotes(content, quote).filter((hit) => hit.end > hit.start);
  if (!hits.length) return [];
  const mark = Decoration.mark({ class: 'piecemaker-citation-mark' });
  return EditorView.decorations.of(Decoration.set(hits.map((hit) => mark.range(hit.start, hit.end)), true));
}
