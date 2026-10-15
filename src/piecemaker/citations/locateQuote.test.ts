import { describe, expect, it } from 'vitest';

import { lineAt, locateQuote, locateQuotes } from '@/piecemaker/citations/locateQuote';

describe('locateQuote', () => {
  it('retrouve une sous-chaîne exacte', () => {
    expect(locateQuote('Bonjour, Gaston !', 'Gaston')).toEqual({ start: 9, end: 15, excerpt: 'Gaston' });
  });

  it('tolère la casse et les espaces', () => {
    const hit = locateQuote('Bonjour,   Gaston !', 'bonjour, gaston');
    expect(hit?.excerpt).toBe('Bonjour,   Gaston');
    expect(hit?.start).toBe(0);
  });

  it('tolère un écart de ponctuation', () => {
    expect(locateQuote('Bonjour, Gaston !', 'Bonjour Gaston')).toEqual({
      start: 0,
      end: 15,
      excerpt: 'Bonjour, Gaston',
    });
  });

  it('découpe une citation abrégée', () => {
    const hits = locateQuotes('Alpha milieu Omega', 'Alpha ... Omega');
    expect(hits.map((hit) => hit.excerpt)).toEqual(['Alpha', 'Omega']);
  });

  it('calcule la ligne d’un offset', () => {
    expect(lineAt('a\nb\nc', 0)).toBe(1);
    expect(lineAt('a\nb\nc', 2)).toBe(2);
    expect(lineAt('a\nb\nc', 4)).toBe(3);
  });
});
