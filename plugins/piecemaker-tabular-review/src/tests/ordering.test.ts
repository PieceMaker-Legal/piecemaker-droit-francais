import { describe, expect, it } from 'vitest';

import { nextSort, sortBy } from '../client/ordering.js';

const sorted = (values: string[], direction: 1 | -1 = 1) => sortBy(values, { key: 'v', direction }, (value) => value);

describe('tri des colonnes', () => {
  it('place les valeurs numériques avant le texte, triées numériquement', () => {
    expect(sorted(['Bail', '10 000 €', 'arrêt', '2 mois', '1 500,50 €', 'Zèbre'])).toEqual(['2 mois', '1 500,50 €', '10 000 €', 'arrêt', 'Bail', 'Zèbre']);
  });

  it('inverse l’ordre en gardant les cellules vides à la fin', () => {
    expect(sorted(['b', '', '3', 'a'], -1)).toEqual(['b', 'a', '3', '']);
    expect(sorted(['b', '', '3', 'a'])).toEqual(['3', 'a', 'b', '']);
  });

  it('alterne croissant, décroissant puis ordre d’origine', () => {
    const first = nextSort(null, 'c1');
    expect(first).toEqual({ key: 'c1', direction: 1 });
    expect(nextSort(first, 'c1')).toEqual({ key: 'c1', direction: -1 });
    expect(nextSort({ key: 'c1', direction: -1 }, 'c1')).toBeNull();
    expect(nextSort({ key: 'c1', direction: -1 }, 'label')).toEqual({ key: 'label', direction: 1 });
  });
});
