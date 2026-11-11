import fs from 'node:fs';
import path from 'node:path';

import { catalaDocumentation } from '../vendor/skills/Skill-PieceMaker/scripts/catala-documentation.mjs';

import type { Concept } from './bundle.js';
import {
  INVOLVES,
  MENTIONS,
  PARTY_TYPE,
  PREMISE_TYPE,
  RELATIONS,
  STATES,
  isPremiseId,
  migratedId,
  readBundle,
  readGraphTypes,
  relationsOf,
  text,
} from './bundle.js';

export const OKF_SCHEME = 'okf:';
export type PremisePiece = { resource: string; title: string; citation: string; value: string };
export type PremiseEvidence = { id: string; title: string; pieces: PremisePiece[] };
export type OkfGap = { element: string; manque: string };

const SKIPPED_FOLDERS = new Set(['resultats', '_build', 'node_modules']);
const LEGAL_SOURCE = /^(?:https?:|(?:LEGIARTI|JURITEXT|CETATEXT|CONSTEXT|JORFTEXT|JORFARTI)\d+$|[0-9a-f]{24}$)/i;

export const isOkfSource = (source: string): boolean => source.toLowerCase().startsWith(OKF_SCHEME);
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

function catalaFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return SKIPPED_FOLDERS.has(entry.name) || entry.name.startsWith('.') ? [] : catalaFiles(filePath);
    return entry.isFile() && /\.catala_(?:fr|en|pl)$/.test(entry.name) ? [filePath] : [];
  });
}

function catalaSources(projectPath: string): Array<{ place: string; source: string }> {
  return catalaFiles(path.join(projectPath, '.piecemaker', 'catala')).sort().flatMap((filePath) => {
    const place = path.relative(projectPath, filePath).split(path.sep).join('/');
    return catalaDocumentation(fs.readFileSync(filePath, 'utf8')).entries
      .filter((entry: { hasDoc: boolean }) => entry.hasDoc)
      .flatMap((entry: { startLine: number; doc: string }) => [...entry.doc.matchAll(/^\s*source\s*:\s*(\S+)\s*$/gim)].map((match) => ({ place: `${place}:${entry.startLine}`, source: match[1] })));
  });
}

export function graphGaps(projectPath: string): OkfGap[] {
  const concepts = readBundle(projectPath).filter((concept) => !concept.error);
  const graphTypes = readGraphTypes(projectPath);
  const premises = concepts.filter((concept) => concept.frontmatter.type === PREMISE_TYPE);
  const gaps: OkfGap[] = [];
  const report = (element: string, manque: string) => gaps.push({ element, manque });

  const linked = new Set<string>();
  const stated = new Set<string>();
  const valued = new Set<string>();
  const involved = new Set<string>();
  for (const concept of concepts) {
    for (const name of [...RELATIONS, STATES]) for (const entry of live(concept, name)) {
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

  const sources = catalaSources(projectPath);
  const used = new Set<string>();
  for (const { place, source } of sources) {
    if (isOkfSource(source)) {
      const id = premiseIdOf(source);
      used.add(id);
      const evidence = evidenceOf(concepts, id);
      if (!evidence) report(place, `#[doc] cite une prémisse absente de l'index : ${id}`);
      else if (!evidence.pieces.length) report(place, `#[doc] cite une prémisse sans pièce citée : ${id}`);
    } else if (!LEGAL_SOURCE.test(source) && !/^[a-z][\w+.-]*:/i.test(source)) {
      report(place, `#[doc] cite une pièce directement (${source}) : citer une prémisse, source: ${OKF_SCHEME}/_premises/<titre>.md`);
    }
  }
  if (sources.length) {
    for (const premise of premises) if (isPremiseId(premise.id) && !used.has(premise.id)) report(premise.id, 'prémisse citée par aucun programme Catala');
  }
  return gaps;
}
