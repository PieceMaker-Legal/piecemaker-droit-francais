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

const WORD = /[\p{L}\p{N}]+/gu;
const NEAREST_MIN_SCORE = 0.6;

export function nearestPassage(source: string, quote: string) {
  const quoted = (quote.replace(/\[\[PAGE_BREAK\]\]/g, ' ').match(WORD) ?? []).map((word) => word.toLowerCase());
  const wanted = new Set(quoted);
  const size = quoted.length;
  if (size < 3) return null;
  const span = Math.ceil(size * 1.25);
  const words = [...source.matchAll(WORD)].map((match) => ({ start: match.index, end: match.index + match[0].length, hit: wanted.has(match[0].toLowerCase()) }));
  let hits = 0;
  let best = { score: 0, from: 0, to: 0 };
  for (let index = 0; index < words.length; index++) {
    if (words[index].hit) hits++;
    if (index >= span && words[index - span].hit) hits--;
    const score = Math.min(1, hits / size);
    if (score > best.score) best = { score, from: Math.max(0, index - span + 1), to: index };
  }
  if (best.score < NEAREST_MIN_SCORE) return null;
  let { from, to } = best;
  while (!words[from].hit) from++;
  while (!words[to].hit) to--;
  return source.slice(words[from].start, words[to].end);
}
