import { afterEach, describe, expect, it } from 'vitest';

import { citationPassage, clearCitationPassage, setCitationPassage } from '@/piecemaker/citations/citationPassage';

afterEach(() => clearCitationPassage());

describe('citationPassage', () => {
  it('retrouve le passage par le chemin complet ou le nom du fichier', () => {
    setCitationPassage('02_DATA_ROOM/12_Contrat_exemple.pdf', 'Contrat de partenariat', 1);
    expect(citationPassage('02_DATA_ROOM/12_Contrat_exemple.pdf')?.quote).toBe('Contrat de partenariat');
    expect(citationPassage('/abs/02_DATA_ROOM/12_Contrat_exemple.pdf')?.quote).toBe('Contrat de partenariat');
    expect(citationPassage('12_Contrat_exemple.pdf')?.page).toBe(1);
  });

  it('oublie le passage une fois effacé', () => {
    setCitationPassage('notes.md', 'Bonjour, Gaston !');
    clearCitationPassage();
    expect(citationPassage('notes.md')).toBeNull();
  });
});
