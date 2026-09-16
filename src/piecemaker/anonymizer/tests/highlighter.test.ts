import { describe, expect, it, vi } from 'vitest';

import { buildAcronymRegex, buildNameRegex, createIdentityHighlighter } from '@/piecemaker/anonymizer/highlighter';

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
    expect(matches(['Jean Dupont'], 'jean dupont, JEAN DUPONT et Jean Dupont'))
      .toEqual(['jean dupont', 'JEAN DUPONT', 'Jean Dupont']);
  });

  it('ignore la casse des codes pseudonymisés', () => {
    expect(matches(['PERSONNE_MORALE_99'], 'personne_morale_99 puis Personne_Morale_99'))
      .toEqual(['personne_morale_99', 'Personne_Morale_99']);
  });

  it('respecte les bornes de mots Unicode', () => {
    expect(matches(['Dupré'], 'Dupré et Duprés')).toEqual(['Dupré']);
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

describe('createIdentityHighlighter', () => {
  it('ne teinte que le fil de conversation, hors zones désactivées', async () => {
    const registeredRanges: Range[][] = [];
    const registry = {
      set: vi.fn((_name: string, highlight: { ranges: Range[] }) => registeredRanges.push(highlight.ranges)),
      delete: vi.fn(),
    };
    vi.stubGlobal('CSS', { highlights: registry });
    vi.stubGlobal('Highlight', class {
      ranges: Range[];

      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    });
    document.body.innerHTML = [
      '<div class="chat-messages-pane">Jean Dupont</div>',
      '<div class="chat-messages-pane"><div data-piecemaker-identity-highlight="off">Jean Dupont</div></div>',
      '<div>Jean Dupont</div>',
    ].join('');

    const highlighter = createIdentityHighlighter();
    highlighter.setNames(['Jean Dupont']);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(registeredRanges.at(-1)?.map((range) => range.toString())).toEqual(['Jean Dupont']);

    highlighter.stop();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });
});
