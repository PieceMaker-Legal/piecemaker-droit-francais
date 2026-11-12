import type { OntologyRelation } from './okf.js';
import { applyKeyedChange, changesMarkup, keyedChanges, type Change, type ChangeDecision, type ProposalShape } from './proposal.js';

export type { ChangeDecision } from './proposal.js';
export type OntologyChange = Change<OntologyRelation>;

const SHAPE: ProposalShape<OntologyRelation> = {
  key: (relation) => relation.name,
  fields: [['label', 'Libellé'], ['inverse', 'Libellé inverse'], ['description', 'Description'], ['source', 'Source'], ['target', 'Cible']],
  empty: (name) => ({ name, label: '', inverse: '', description: '', source: [], target: [] }),
  unchanged: 'La proposition reprend l’ontologie actuelle sans changement.',
};

export const ontologyChanges = (current: OntologyRelation[], proposed: OntologyRelation[]) => keyedChanges(SHAPE, current, proposed);
export const applyChange = (relations: OntologyRelation[], change: OntologyChange) => applyKeyedChange(SHAPE, relations, change);
export const proposalMarkup = (changes: OntologyChange[], decisions: Array<ChangeDecision | undefined>, motif: string) => changesMarkup(SHAPE, changes, decisions, motif);
