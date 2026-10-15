export type QuoteHit = {
  start: number;
  end: number;
  excerpt: string;
};

function isPunctuation(character: string) {
  return !/[\p{L}\p{N}\s]/u.test(character);
}

function normalizeWithMap(text: string, stripPunctuation = false) {
  const norm: string[] = [];
  const origIdx: number[] = [];
  let prevSpace = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (/\s/.test(character)) {
      if (!prevSpace) {
        norm.push(' ');
        origIdx.push(index);
        prevSpace = true;
      }
    } else if (stripPunctuation && isPunctuation(character)) {
      continue;
    } else {
      norm.push(character.toLowerCase());
      origIdx.push(index);
      prevSpace = false;
    }
  }
  return { norm: norm.join(''), origIdx };
}

function locateNormalized(source: string, quote: string, stripPunctuation: boolean): QuoteHit | null {
  const { norm, origIdx } = normalizeWithMap(source, stripPunctuation);
  const needle = normalizeWithMap(quote, stripPunctuation).norm.trim();
  if (!needle) return null;
  const pos = norm.indexOf(needle);
  if (pos < 0) return null;
  const endNormPos = pos + needle.length;
  const start = origIdx[pos] ?? 0;
  const end = endNormPos - 1 < origIdx.length ? origIdx[endNormPos - 1] + 1 : source.length;
  return { start, end, excerpt: source.slice(start, end) };
}

export function locateQuote(source: string, quote: string): QuoteHit | null {
  if (!source || !quote) return null;
  const exactIdx = source.indexOf(quote);
  if (exactIdx >= 0) return { start: exactIdx, end: exactIdx + quote.length, excerpt: quote };
  return locateNormalized(source, quote, false) ?? locateNormalized(source, quote, true);
}

export function locateQuotes(source: string, quote: string): QuoteHit[] {
  const whole = locateQuote(source, quote);
  if (whole) return [whole];
  const segments = quote
    .split(/\.{3}|…/)
    .map((part) => part.trim())
    .filter((part) => /[\p{L}\p{N}]/u.test(part));
  if (segments.length <= 1) return [];
  return segments.flatMap((segment) => {
    const hit = locateQuote(source, segment);
    return hit ? [hit] : [];
  });
}

export function lineAt(source: string, offset: number) {
  let line = 1;
  const end = Math.min(Math.max(offset, 0), source.length);
  for (let index = 0; index < end; index += 1) if (source[index] === '\n') line += 1;
  return line;
}
