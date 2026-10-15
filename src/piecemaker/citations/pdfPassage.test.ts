import { describe, expect, it } from 'vitest';

import { highlightRectsForQuote, pageTextFromItems } from '@/piecemaker/citations/pdfPassage';

const viewport = { transform: [1, 0, 0, -1, 0, 200], scale: 1 };

describe('pdfPassage', () => {
  it('joint les glyphes avec un espace pour retrouver la citation', () => {
    const items = [
      { str: 'Bonjour', transform: [12, 0, 0, 12, 10, 100], width: 70, height: 12 },
      { str: 'Gaston', transform: [12, 0, 0, 12, 90, 100], width: 60, height: 12 },
    ];
    expect(pageTextFromItems(items).text).toBe('Bonjour Gaston');
    const rects = highlightRectsForQuote(items, 'Gaston', viewport);
    expect(rects).toHaveLength(1);
    expect(rects[0].left).toBeCloseTo(90);
    expect(rects[0].width).toBeCloseTo(60);
    expect(rects[0].height).toBeCloseTo(12);
  });

  it('ne produit aucun rectangle si l’extrait est absent', () => {
    const items = [{ str: 'Bonjour', transform: [12, 0, 0, 12, 10, 100], width: 70, height: 12 }];
    expect(highlightRectsForQuote(items, 'Gaston', viewport)).toEqual([]);
  });
});
