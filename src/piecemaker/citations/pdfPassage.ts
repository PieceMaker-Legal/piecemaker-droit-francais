import { locateQuotes } from '@/piecemaker/citations/locateQuote';

export type PdfGlyph = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

export type HighlightRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type MappedChar = { item: number; offset: number } | 'space';

function applyTransform(left: number[], right: number[]) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

export function pdfGlyphsFromItems(items: unknown[]): PdfGlyph[] {
  const glyphs: PdfGlyph[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { str?: unknown; transform?: unknown; width?: unknown; height?: unknown };
    if (typeof record.str !== 'string' || !Array.isArray(record.transform) || record.transform.length < 6) continue;
    glyphs.push({
      str: record.str,
      transform: record.transform.map(Number),
      width: Number(record.width) || 0,
      height: Number(record.height) || 0,
    });
  }
  return glyphs;
}

export function pageTextFromItems(items: PdfGlyph[]) {
  let text = '';
  const map: MappedChar[] = [];
  items.forEach((item, itemIndex) => {
    if (text.length > 0 && !/\s$/.test(text) && item.str !== '' && !/^\s/.test(item.str)) {
      text += ' ';
      map.push('space');
    }
    for (let offset = 0; offset < item.str.length; offset += 1) {
      text += item.str[offset];
      map.push({ item: itemIndex, offset });
    }
  });
  return { text, map };
}

function glyphRect(item: PdfGlyph, viewportTransform: number[], scale: number, startFrac: number, endFrac: number): HighlightRect {
  const tx = applyTransform(viewportTransform, item.transform);
  const height = Math.hypot(tx[2], tx[3]) || item.height * scale;
  const width = item.width * scale;
  return {
    left: tx[4] + width * startFrac,
    top: tx[5] - height,
    width: Math.max(width * (endFrac - startFrac), 1),
    height,
  };
}

export function highlightRectsForQuote(
  items: PdfGlyph[],
  quote: string,
  viewport: { transform: number[]; scale: number },
): HighlightRect[] {
  const { text, map } = pageTextFromItems(items);
  const rects: HighlightRect[] = [];
  for (const hit of locateQuotes(text, quote)) {
    let run: { item: number; start: number; end: number } | null = null;
    const flush = () => {
      if (!run) return;
      const item = items[run.item];
      const length = item.str.length || 1;
      rects.push(glyphRect(item, viewport.transform, viewport.scale, run.start / length, run.end / length));
      run = null;
    };
    for (let index = hit.start; index < hit.end; index += 1) {
      const entry = map[index];
      if (!entry || entry === 'space') {
        flush();
        continue;
      }
      if (!run || run.item !== entry.item) {
        flush();
        run = { item: entry.item, start: entry.offset, end: entry.offset + 1 };
      } else {
        run.end = entry.offset + 1;
      }
    }
    flush();
  }
  return rects;
}
