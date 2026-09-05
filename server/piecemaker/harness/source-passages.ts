import { createRequire } from 'node:module';
import path from 'node:path';

import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

const root = findApplicationRoot(getModuleDirectory(import.meta.url));
const { locateQuote, verifyQuoteAgainstSource } = createRequire(import.meta.url)(
  path.join(root, 'server/piecemaker/vendor/piecemaker-plugin/scripts/lib/verify-citations.cjs'),
);

export function locateSourcePassages(source: string, quotes: Array<{ quote: string }>) {
  const ranges: Array<{ start: number; end: number; quoteIndex: number }> = [];
  quotes.forEach((quote, quoteIndex) => {
    if (!verifyQuoteAgainstSource(source, quote.quote).verified) return;
    for (const segment of quote.quote.split(/\[\[PAGE_BREAK\]\]|\.{3}|…/).map((part) => part.trim()).filter(Boolean)) {
      const location = locateQuote(source, segment);
      if (location) ranges.push({ start: location.start, end: location.end, quoteIndex });
    }
  });
  return ranges;
}
