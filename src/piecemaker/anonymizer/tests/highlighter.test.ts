import { describe, expect, it } from 'vitest';

import { buildNameRegex } from '@/piecemaker/anonymizer/highlighter';

function matches(names: string[], text: string): string[] {
  const pattern = buildNameRegex(names);
  if (!pattern) return [];
  return Array.from(text.matchAll(pattern), (match) => match[0]);
}

describe('buildNameRegex', () => {
  it('ignore la casse du texte affiché', () => {
    expect(matches(['Paul Durand'], 'paul durand, PAUL DURAND et Paul Durand'))
      .toEqual(['paul durand', 'PAUL DURAND', 'Paul Durand']);
  });

  it('ignore la casse des codes pseudonymisés', () => {
    expect(matches(['PERSONNE_MORALE_99'], 'personne_morale_99 puis Personne_Morale_99'))
      .toEqual(['personne_morale_99', 'Personne_Morale_99']);
  });

  it('respecte les bornes de mots Unicode', () => {
    expect(matches(['Thévenet'], 'Thévenet et Thévenets')).toEqual(['Thévenet']);
  });

  it('renvoie null sans nom', () => {
    expect(buildNameRegex([])).toBeNull();
  });
});
