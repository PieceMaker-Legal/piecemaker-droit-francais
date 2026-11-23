import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { Concept } from './bundle.js';
import { UNCLASSIFIED, isEntityId, isPartyId, isoDateOf, migratedId, readBundle, relationsOf, text } from './bundle.js';
import { FGLP_PROPERTIES, HELD_BY, LEGAL_POSITION, isA, lofId, lofLabel } from './lof.js';
import { graphTypesOf } from './ontology.js';
import type { ReviewAuthor } from './reviews.js';
import { reviewRowPieces } from './reviews.js';

export const OKF_SCHEME = 'okf:';
export type PremisePiece = { resource: string; title: string; citation: string; value: string; origin: string; author?: ReviewAuthor; review?: string };
export type PremiseEvidence = { id: string; title: string; pieces: PremisePiece[] };
export type OkfGap = { element: string; manque: string; avocat?: true };
export type OkfExamined = { element: string; motif: string; by: string; at: string };
export const EXAMINED = 'examen_sans_lien';
/** Revues tabulaires liées à une fiche LOF : leurs lignes positives l'établissent. */
export const REVIEWS = 'revues';
export const REVIEW_ACTOR = 'piecemaker/tabular-review';
export const EXAMINE_HINT = 'pm okf examinee <pièce> --motif "…"';

export const fingerprintOf = (projectPath: string, resource: string): string => {
  const filePath = path.join(projectPath, resource);
  return fs.existsSync(filePath) ? createHash('sha256').update(fs.readFileSync(filePath)).digest('hex') : '';
};

export const premiseIdOf = (source: string): string => migratedId(`/${source.slice(OKF_SCHEME.length).replace(/^\/+/, '')}`);

const liveLinks = (concept: Concept) => Object.entries(relationsOf(concept.frontmatter)).flatMap(([relation, entries]) => entries.filter((entry) => !entry.dismissed).map((entry) => ({ relation, ...entry })));
const classOf = (concept: Concept): string => lofId(text(concept.frontmatter.lof), ['class']) || '';

export const linkedReviews = (premise: Concept): Array<{ fichier: string; colonne: number }> => (Array.isArray(premise.frontmatter[REVIEWS]) ? premise.frontmatter[REVIEWS] as Array<Record<string, unknown>> : [])
  .map((entry) => ({ fichier: text(entry?.fichier), colonne: Number(entry?.colonne) }))
  .filter((entry) => entry.fichier && Number.isInteger(entry.colonne));

/** Les lignes positives des revues liées, lues dans les revues elles-mêmes : chacune est une pièce signée agent ou humain. */
export function reviewPieces(projectPath: string, premise: Concept, concepts: Concept[]): PremisePiece[] {
  return linkedReviews(premise).flatMap((link) => reviewRowPieces(projectPath, link.fichier, link.colonne).lignes.map((row) => ({
    resource: row.resource,
    title: text(concepts.find((concept) => text(concept.frontmatter.resource) === row.resource)?.frontmatter.title) || row.label,
    citation: row.citation,
    value: row.value,
    origin: REVIEW_ACTOR,
    author: row.author,
    review: link.fichier,
  })));
}

function evidenceOf(projectPath: string, concepts: Concept[], id: string): PremiseEvidence | null {
  const entity = concepts.find((concept) => concept.id === id && isEntityId(concept.id));
  if (!entity) return null;
  const titleOf = (pieceId: string) => concepts.find((concept) => concept.id === pieceId);
  const pieces: PremisePiece[] = concepts.flatMap((concept) => liveLinks(concept)
    .filter((entry) => concept.id === id || entry.target === id)
    .flatMap((entry) => {
      const piece = titleOf(entry.piece || '') || (isEntityId(concept.id) || isPartyId(concept.id) ? undefined : concept);
      return piece ? [{ resource: text(piece.frontmatter.resource), title: text(piece.frontmatter.title), citation: entry.citation, value: entry.value || '', origin: entry.origin }] : [];
    }));
  return { id, title: text(entity.frontmatter.title), pieces: [...pieces, ...reviewPieces(projectPath, entity, concepts)] };
}

export function premiseEvidence(projectPath: string, source: string): PremiseEvidence | null {
  return evidenceOf(projectPath, readBundle(projectPath).filter((concept) => !concept.error), premiseIdOf(source));
}

const NUMBER = /-?\d[\d   ]*(?:[.,]\d+)*/;

function numberOf(value: string): number | null {
  const digits = value.match(NUMBER)?.[0].replace(/[   ]/g, '');
  if (!digits) return null;
  const normalized = digits.includes('.') && digits.includes(',') ? digits.replace(/,/g, '') : digits.replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function expectedValue(expression: string): { date: string } | { number: number } | null {
  const date = expression.match(/^\|(\d{4}-\d{2}-\d{2})\|$/)?.[1];
  if (date) return { date };
  if (!/^\$?-?\d[\d   .,]*(?:\s*(?:€|[\p{L}]+))?$/u.test(expression)) return null;
  const number = numberOf(expression);
  return number === null ? null : { number };
}

export function matchesExpected(expected: { date: string } | { number: number }, value: string): boolean {
  return 'date' in expected ? isoDateOf(value) === expected.date : numberOf(value) === expected.number;
}

export function graphReport(projectPath: string): { manques: OkfGap[]; examinees: OkfExamined[] } {
  const concepts = readBundle(projectPath).filter((concept) => !concept.error);
  const graphTypes = graphTypesOf(projectPath);
  const gaps: OkfGap[] = [];
  const examined: OkfExamined[] = [];
  const report = (element: string, manque: string, avocat = false) => gaps.push({ element, manque, ...(avocat ? { avocat: true as const } : {}) });
  const parties = concepts.filter((concept) => isPartyId(concept.id));
  const clients = new Set(parties.filter((party) => text(party.frontmatter.side) === 'client').map((party) => party.id));

  const linked = new Set<string>();
  for (const concept of concepts) for (const entry of liveLinks(concept)) {
    linked.add(concept.id).add(entry.target);
    if (entry.piece) linked.add(entry.piece);
  }

  for (const concept of concepts) {
    const type = text(concept.frontmatter.type);
    if (isEntityId(concept.id) || isPartyId(concept.id) || !graphTypes.includes(type) || linked.has(concept.id)) continue;
    const mark = concept.frontmatter[EXAMINED] as Record<string, unknown> | undefined;
    const fresh = mark && text(mark.empreinte) && text(mark.empreinte) === fingerprintOf(projectPath, text(concept.frontmatter.resource));
    if (mark && fresh) examined.push({ element: concept.id, motif: text(mark.motif), by: text(mark.by), at: text(mark.at) });
    else if (mark) report(concept.id, `pièce modifiée depuis son examen sans lien du ${text(mark.at).slice(0, 10)} : la réexaminer, puis pm okf link ou ${EXAMINE_HINT}`);
    else report(concept.id, `pièce à examiner : aucun lien LOF ne la cite ; si aucun passage ne justifie un lien : ${EXAMINE_HINT}`);
  }

  const positions = concepts.filter((concept) => isEntityId(concept.id) && isA(classOf(concept), LEGAL_POSITION));
  const heldByClient = (position: Concept) => liveLinks(position).some((entry) => entry.relation === lofLabel(HELD_BY) && clients.has(entry.target));
  for (const position of [...positions].sort((left, right) => Number(heldByClient(right)) - Number(heldByClient(left)))) {
    const present = new Set(liveLinks(position).map((entry) => entry.relation));
    const missing = FGLP_PROPERTIES.map(lofLabel).filter((label) => !present.has(label));
    if (!missing.length) continue;
    if (missing.includes(lofLabel(HELD_BY)) && !parties.length) report(position.id, `${lofLabel(LEGAL_POSITION)} sans titulaire (${lofLabel(HELD_BY)}) : attend l’avocat, aucune partie qualifiée dans le dossier ; il désigne une partie cliente ou adverse dans l’onglet Dossier, vue générale (colonnes Parties clientes et Parties adverses, ou champ Rôle de la fiche) ; ne la qualifie pas toi-même`, true);
    report(position.id, `${lofLabel(LEGAL_POSITION)}${heldByClient(position) ? ' du client' : ''} incomplète : ${missing.map((label) => `« ${label} »`).join(', ')} sans lien cité`);
  }
  for (const party of parties) if (!linked.has(party.id)) report(party.id, 'partie sans lien LOF cité');
  for (const entity of concepts.filter((concept) => isEntityId(concept.id))) {
    if (text(entity.frontmatter.type) === UNCLASSIFIED) report(entity.id, 'fiche sans classe LOF');
    else if (!linked.has(entity.id) && !reviewPieces(projectPath, entity, concepts).length) report(entity.id, 'fiche sans pièce citée');
  }

  return { manques: gaps, examinees: examined };
}

export const graphGaps = (projectPath: string): OkfGap[] => graphReport(projectPath).manques;
