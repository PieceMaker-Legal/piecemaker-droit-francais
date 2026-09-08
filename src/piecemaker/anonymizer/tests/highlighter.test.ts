import { describe, expect, it } from 'vitest';

import { buildAcronymRegex, buildNameRegex } from '@/piecemaker/anonymizer/highlighter';

function matches(names: string[], text: string): string[] {
  const pattern = buildNameRegex(names);
  if (!pattern) return [];
  return Array.from(text.matchAll(pattern), (match) => match[0]);
}

function acronymMatches(acronyms: string[], text: string): string[] {
  const pattern = buildAcronymRegex(acronyms);
  if (!pattern) return [];
  return Array.from(text.matchAll(pattern), (match) => match[0]);
}

describe('buildNameRegex', () => {
  it('ignore la casse du texte affiché', () => {
    expect(matches(['Bernard Gilly'], 'bernard gilly, BERNARD GILLY et Bernard Gilly'))
      .toEqual(['bernard gilly', 'BERNARD GILLY', 'Bernard Gilly']);
  });

  it('ignore la casse des codes pseudonymisés', () => {
    expect(matches(['PERSONNE_MORALE_99'], 'personne_morale_99 puis Personne_Morale_99'))
      .toEqual(['personne_morale_99', 'Personne_Morale_99']);
  });

  it('respecte les bornes de mots Unicode', () => {
    expect(matches(['Motté'], 'Motté et Mottés')).toEqual(['Motté']);
  });

  it('renvoie null sans nom', () => {
    expect(buildNameRegex([])).toBeNull();
  });
});

describe('buildAcronymRegex', () => {
  it('respecte la casse, comme le moteur de substitution', () => {
    expect(acronymMatches(['US'], 'US et us')).toEqual(['US']);
  });

  it('ne teinte pas l\'intérieur d\'un mot', () => {
    expect(acronymMatches(['US'], 'BUS USA US')).toEqual(['US']);
  });
});
