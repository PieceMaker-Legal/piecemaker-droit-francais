import type { Concept } from './bundle.js';
import {
  INVOLVES,
  MENTIONS,
  PARTY_TYPE,
  PREMISE_TYPE,
  STATES,
  migratedId,
  readBundle,
  relationsOf,
  text,
} from './bundle.js';
import { graphTypesOf, readOntology, relationNames } from './ontology.js';

export const OKF_SCHEME = 'okf:';
export type PremisePiece = { resource: string; title: string; citation: string; value: string };
export type PremiseEvidence = { id: string; title: string; pieces: PremisePiece[] };
export type OkfGap = { element: string; manque: string; programmes?: string[] };

export const premiseIdOf = (source: string): string => migratedId(`/${source.slice(OKF_SCHEME.length).replace(/^\/+/, '')}`);

const live = (concept: Concept, relation: string) => (relationsOf(concept.frontmatter)[relation] || []).filter((entry) => !entry.dismissed);

function evidenceOf(concepts: Concept[], id: string): PremiseEvidence | null {
  const premise = concepts.find((concept) => concept.id === id && concept.frontmatter.type === PREMISE_TYPE);
  if (!premise) return null;
  const pieces = concepts.flatMap((concept) => live(concept, STATES)
    .filter((entry) => entry.target === id)
    .map((entry) => ({ resource: text(concept.frontmatter.resource), title: text(concept.frontmatter.title), citation: entry.citation, value: entry.value || '' })));
  return { id, title: text(premise.frontmatter.title), pieces };
}

export function premiseEvidence(projectPath: string, source: string): PremiseEvidence | null {
  return evidenceOf(readBundle(projectPath).filter((concept) => !concept.error), premiseIdOf(source));
}

export function graphGaps(projectPath: string): OkfGap[] {
  const concepts = readBundle(projectPath).filter((concept) => !concept.error);
  const ontology = readOntology(projectPath);
  const graphTypes = graphTypesOf(projectPath, ontology);
  const premises = concepts.filter((concept) => concept.frontmatter.type === PREMISE_TYPE);
  const gaps: OkfGap[] = [];
  const report = (element: string, manque: string) => gaps.push({ element, manque });

  const linked = new Set<string>();
  const stated = new Set<string>();
  const valued = new Set<string>();
  const involved = new Set<string>();
  for (const concept of concepts) {
    for (const name of [...relationNames(ontology), STATES]) for (const entry of live(concept, name)) {
      linked.add(concept.id).add(entry.target);
      if (name !== STATES) continue;
      stated.add(entry.target);
      if (entry.value) valued.add(entry.target);
    }
    for (const name of [MENTIONS, INVOLVES]) for (const entry of live(concept, name)) involved.add(entry.target);
  }

  for (const concept of concepts) {
    const type = text(concept.frontmatter.type);
    if (graphTypes.includes(type) && !linked.has(concept.id)) report(concept.id, 'pièce sans prémisse ni lien vers une autre pièce');
    if (type === PARTY_TYPE && !involved.has(concept.id)) report(concept.id, 'partie sans mention dans une pièce ni prémisse qui la concerne');
  }
  for (const premise of premises) {
    if (!stated.has(premise.id)) report(premise.id, 'prémisse sans pièce citée');
    else if (premise.frontmatter.single_value === true && !valued.has(premise.id)) report(premise.id, 'prémisse à valeur unique sans valeur');
    if (!live(premise, INVOLVES).length) report(premise.id, 'prémisse sans partie concernée (involves)');
  }

  return gaps;
}
