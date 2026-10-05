import { describe, expect, it } from 'vitest';

import { deleteEntityOperations, removedAliasOperations } from '../exclusions.js';

const JEAN = 'entity:PERSONNE_PHYSIQUE_01';

describe('deleteEntityOperations', () => {
  it('excludes the label and every alias for the case, then deletes the node', () => {
    expect(deleteEntityOperations(JEAN, ['Jean Dupont', 'J. Dupont', ' Jean Dupont ', ''], 'dossier')).toEqual([
      { op: 'excludeTerm', term: 'Jean Dupont' },
      { op: 'excludeTerm', term: 'J. Dupont' },
      { op: 'deleteNode', nodeId: JEAN },
    ]);
  });

  it('only deletes the node when the term is excluded from every case', () => {
    expect(deleteEntityOperations(JEAN, ['Jean Dupont', 'J. Dupont'], 'tous')).toEqual([{ op: 'deleteNode', nodeId: JEAN }]);
  });
});

describe('removedAliasOperations', () => {
  it('excludes each removed alias for its entity', () => {
    expect(removedAliasOperations(JEAN, ['Jean Dupont', 'J. Dupont', 'M. Dupont'], ['Jean Dupont', 'M. Dupont'])).toEqual([
      { op: 'excludeAlias', exclusion: { entite: JEAN, alias: 'J. Dupont' } },
    ]);
  });

  it('ignores case, accents and a promoted alias', () => {
    expect(removedAliasOperations(JEAN, ['Jean Dupont', 'Jérôme Dupont'], ['JEROME DUPONT', 'jean dupont'])).toEqual([]);
    expect(removedAliasOperations(JEAN, ['Jean Dupont', 'J. Dupont'], ['J. Dupont'])).toEqual([
      { op: 'excludeAlias', exclusion: { entite: JEAN, alias: 'Jean Dupont' } },
    ]);
  });

  it('excludes nothing when nothing was removed', () => {
    expect(removedAliasOperations(JEAN, ['Jean Dupont'], ['Jean Dupont', 'J. Dupont'])).toEqual([]);
  });
});
