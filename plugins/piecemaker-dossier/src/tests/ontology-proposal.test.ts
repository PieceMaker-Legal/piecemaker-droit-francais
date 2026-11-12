import { describe, expect, it } from 'vitest';

import { applyChange, ontologyChanges, proposalMarkup } from '../ontology-proposal.js';
import type { OntologyRelation } from '../okf.js';

const relation = (name: string, label: string, target = ['Pièces']): OntologyRelation => ({ name, label, inverse: `${label} par`, description: '', source: ['Pièces'], target });

describe('proposition d’ontologie', () => {
  const current = [relation('amends', 'modifie'), relation('refers-to', 'cite')];
  const proposed = [relation('amends', 'amende', ['Pièces', 'Projets']), relation('responds-to', 'répond à')];
  const changes = ontologyChanges(current, proposed);

  it('distingue ajout, modification et suppression', () => {
    expect(changes.map((change) => [change.kind, change.name])).toEqual([['modification', 'amends'], ['ajout', 'responds-to'], ['suppression', 'refers-to']]);
    expect(ontologyChanges(current, current)).toEqual([]);
  });

  it('applique un changement accepté sans toucher aux autres', () => {
    const applied = changes.reduce(applyChange, current);
    expect(applied.map((entry) => [entry.name, entry.label])).toEqual([['amends', 'amende'], ['responds-to', 'répond à']]);
  });

  it('montre le texte retiré et ajouté, et les boutons tant qu’aucune décision n’est prise', () => {
    const markup = proposalMarkup(changes, ['acceptee', undefined, undefined], 'Préciser les libellés');
    expect(markup).toContain('<del>modifie</del> <ins>amende</ins>');
    expect(markup).not.toContain('Projets');
    expect(markup).toContain('Acceptée');
    expect(markup).toContain('data-change-edit="1"');
    expect(markup).not.toContain('data-change-edit="2"');
    expect(markup).toContain('Préciser les libellés');
  });
});
