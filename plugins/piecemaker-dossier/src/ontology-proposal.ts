import type { DocumentType } from './document-types.js';
import type { OntologyRelation } from './okf.js';
import { applyKeyedChange, changesMarkup, keyedChanges, type Change, type ChangeDecision, type ProposalShape } from './proposal.js';

export type { ChangeDecision } from './proposal.js';
export type OntologyChange = Change<OntologyRelation>;

const SHAPE: ProposalShape<OntologyRelation> = {
  key: (relation) => relation.name,
  fields: [['label', 'Libellé'], ['inverse', 'Libellé inverse'], ['description', 'Description']],
  empty: (name) => ({ name, label: '', inverse: '', description: '', source: [], target: [] }),
  unchanged: 'La proposition reprend l’ontologie actuelle sans changement.',
};

export const ontologyChanges = (current: OntologyRelation[], proposed: OntologyRelation[]) => keyedChanges(SHAPE, current, proposed);
export const applyChange = (relations: OntologyRelation[], change: OntologyChange) => applyKeyedChange(SHAPE, relations, change);
export const proposalMarkup = (changes: OntologyChange[], decisions: Array<ChangeDecision | undefined>, motif: string) => changesMarkup(SHAPE, changes, decisions, motif);

const TYPE_SHAPE: ProposalShape<DocumentType> = {
  key: (type) => type.name,
  fields: [['icon', 'Icône']],
  empty: (name) => ({ name, icon: '' }),
  unchanged: 'La proposition reprend les types actuels sans changement.',
};

export const typeChanges = (current: DocumentType[], proposed: DocumentType[]) => keyedChanges(TYPE_SHAPE, current, proposed);
export const applyTypeChange = (types: DocumentType[], change: Change<DocumentType>) => applyKeyedChange(TYPE_SHAPE, types, change);
export const typesProposalMarkup = (changes: Array<Change<DocumentType>>, decisions: Array<ChangeDecision | undefined>, motif: string) => changesMarkup(TYPE_SHAPE, changes, decisions, motif);
