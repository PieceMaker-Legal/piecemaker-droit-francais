import { describe, expect, it } from 'vitest';

import { sentenceContaining } from '../excerpt.js';

describe('sentenceContaining', () => {
  it('returns the sentence around the first occurrence', () => {
    const markdown = 'Le contrat est signé. Jean Dupont s’engage à payer le loyer. Il habite Paris.';
    expect(sentenceContaining(markdown, ['Jean Dupont'])).toBe('Jean Dupont s’engage à payer le loyer.');
  });

  it('ignores case and accents', () => {
    expect(sentenceContaining('Bail conclu. SOCIÉTÉ EXEMPLE SAS représente le bailleur! Fin.', ['Société Exemple SAS'])).toBe('SOCIÉTÉ EXEMPLE SAS représente le bailleur!');
  });

  it('keeps the original text and picks the earliest of several values', () => {
    expect(sentenceContaining('Premier paragraphe.\nM. Dupont est présent.\nJean Dupont signe.', ['Jean Dupont', 'M. Dupont'])).toBe('M. Dupont est présent.');
  });

  it('does not cut a sentence after an abbreviation or an initial', () => {
    expect(sentenceContaining('Fait à Paris. Mme Martin et J. Dupont ont signé le 3 mars. Fin.', ['Dupont'])).toBe('Mme Martin et J. Dupont ont signé le 3 mars.');
  });

  it('stops at a line break and strips markdown markers', () => {
    expect(sentenceContaining('# Titre\n- Jean Dupont, demeurant 12 rue des Lilas, Paris\n- Autre ligne', ['Jean Dupont'])).toBe('Jean Dupont, demeurant 12 rue des Lilas, Paris');
  });

  it('only matches whole words', () => {
    expect(sentenceContaining('Dupontel signe. Puis Dupont paie.', ['Dupont'])).toBe('Puis Dupont paie.');
  });

  it('tolerates repeated spaces inside the name', () => {
    expect(sentenceContaining('Il a vu Jean   Dupont hier.', ['Jean Dupont'])).toBe('Il a vu Jean Dupont hier.');
  });

  it('truncates a long sentence around the match at a word boundary', () => {
    const filler = 'mot '.repeat(120);
    const excerpt = sentenceContaining(`${filler}Jean Dupont ${filler}fin.`, ['Jean Dupont'], 100) as string;
    expect(excerpt).toContain('Jean Dupont');
    expect(excerpt.length).toBeLessThanOrEqual(102);
    expect(excerpt.startsWith('…')).toBe(true);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('truncates the end only when the match is at the start', () => {
    const excerpt = sentenceContaining(`Jean Dupont ${'mot '.repeat(200)}fin.`, ['Jean Dupont'], 100) as string;
    expect(excerpt.startsWith('Jean Dupont')).toBe(true);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(101);
  });

  it('returns null when no value occurs or no value is given', () => {
    expect(sentenceContaining('Aucun nom ici.', ['Jean Dupont'])).toBeNull();
    expect(sentenceContaining('Texte.', [])).toBeNull();
    expect(sentenceContaining('', ['Jean Dupont'])).toBeNull();
  });
});
