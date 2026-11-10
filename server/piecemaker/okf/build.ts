import fs from 'node:fs';
import path from 'node:path';

import { sentenceContaining } from '../../../plugins/piecemaker-dossier/src/excerpt.js';
import type { KnowledgeSnapshot } from '../../../plugins/piecemaker-dossier/src/types.js';

import type { Atom, Concept, Frontmatter, Relation, Relations } from './bundle.js';
import {
  OKF_VERSION,
  SCAN_ACTOR,
  UNCLASSIFIED,
  atomsBody,
  bundleRoot,
  conceptFile,
  conceptId,
  readBundle,
  readGraphTypes,
  readTypes,
  relationsOf,
  resourceOf,
  serializeConcept,
  text,
  typeOf,
  writeIfChanged,
} from './bundle.js';

export type SourceDocument = { resource: string; title: string; nature: string; date: string; atoms: Atom[] };
export type MarkdownOf = (resource: string) => string | null;
export type Renamed = { previous: string; current: string };

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const WRITTEN_DATE = /(\d{1,2})(?:er)?\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre)\s+(\d{4})/gi;
const NUMERIC_DATE = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g;

const fold = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('fr');
const iso = (year: string, month: number, day: string): string => `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;

export function datesIn(line: string): Array<{ literal: string; date: string }> {
  return [
    ...[...line.matchAll(WRITTEN_DATE)].map((match) => ({ literal: match[0], date: iso(match[3], MONTHS.indexOf(fold(match[2])) + 1, match[1]) })),
    ...[...line.matchAll(NUMERIC_DATE)].map((match) => ({ literal: match[0], date: iso(match[3], Number(match[2]), match[1]) })),
  ];
}

export function documentsFromSnapshot(projectPath: string, snapshot: KnowledgeSnapshot): SourceDocument[] {
  const documents = new Map<string, SourceDocument>();
  for (const node of snapshot.nodes) {
    const filePath = text(node.data.path);
    if (node.kind !== 'document' || !filePath || !fs.existsSync(filePath)) continue;
    const resource = resourceOf(projectPath, filePath);
    if (resource.startsWith('..')) continue;
    const atoms = snapshot.citations
      .filter((citation) => citation.fromNodeId === node.id && citation.toNodeId.startsWith('entity:') && citation.texte)
      .map((citation) => ({ code: citation.toNodeId.slice('entity:'.length), citation: citation.texte }))
      .sort((left, right) => left.code.localeCompare(right.code));
    documents.set(resource, { resource, title: node.label, nature: text(node.data.nature), date: text(node.date), atoms });
  }
  return [...documents.values()].sort((left, right) => left.resource.localeCompare(right.resource));
}

function scanRelations(source: SourceDocument, targets: SourceDocument[], markdown: string): Relation[] {
  const byDate = new Map<string, SourceDocument[]>();
  for (const target of targets) {
    if (target.resource === source.resource || !target.date || !target.nature) continue;
    byDate.set(target.date, [...(byDate.get(target.date) || []), target]);
  }
  const found = new Map<string, Relation>();
  if (!byDate.size) return [];
  for (const line of markdown.split('\n')) {
    for (const { literal, date } of datesIn(line)) {
      const candidates = byDate.get(date);
      const sentence = candidates && sentenceContaining(line, [literal]);
      if (!sentence) continue;
      const folded = fold(sentence);
      const matching = (candidates as SourceDocument[]).filter((target) => folded.includes(fold(target.nature)));
      if (matching.length !== 1) continue;
      const cible = conceptId(matching[0].resource);
      if (!found.has(cible)) found.set(cible, { cible, citation: sentence, origine: SCAN_ACTOR });
    }
  }
  return [...found.values()];
}

function renamedConcepts(concepts: Concept[], renamed?: Renamed): Map<string, Concept> {
  const from = renamed ? conceptId(renamed.previous) : '';
  const to = renamed ? conceptId(renamed.current) : '';
  const move = (id: string): string => id === from ? to : id;
  return new Map(concepts.filter((concept) => !concept.error).map((concept) => {
    const relations = relationsOf(concept.frontmatter);
    for (const entries of Object.values(relations)) for (const entry of entries) entry.cible = move(entry.cible);
    return [move(concept.id), { ...concept, id: move(concept.id), frontmatter: { ...concept.frontmatter, relations } }];
  }));
}

function mergedRelations(existing: Relations, scanned: Relation[]): Relations {
  const relations: Relations = {};
  for (const [name, entries] of Object.entries(existing)) {
    const kept = entries.filter((entry) => entry.origine !== SCAN_ACTOR || entry.ecarte);
    if (kept.length) relations[name] = kept;
  }
  const known = new Set(Object.values(relations).flat().map((entry) => entry.cible));
  const added = scanned.filter((entry) => !known.has(entry.cible));
  if (added.length) relations['se-refere-a'] = [...(relations['se-refere-a'] || []), ...added];
  for (const entries of Object.values(relations)) entries.sort((left, right) => left.cible.localeCompare(right.cible));
  return relations;
}

function indexContent(entries: Array<{ id: string; frontmatter: Frontmatter }>, types: string[]): string {
  const sections = [...types, UNCLASSIFIED].flatMap((type) => {
    const lines = entries
      .filter((entry) => entry.frontmatter.type === type)
      .map((entry) => `* [${text(entry.frontmatter.title)}](${encodeURI(entry.id)}) - ${text(entry.frontmatter.description)}`);
    return lines.length ? [`# ${type}\n\n${lines.join('\n')}`] : [];
  });
  return `---\nokf_version: "${OKF_VERSION}"\n---\n\n${sections.join('\n\n')}\n`;
}

function pruneEmptyDirectories(directory: string, root: string): void {
  for (let current = directory; current.startsWith(root) && current !== root; current = path.dirname(current)) {
    if (fs.readdirSync(current).length) return;
    fs.rmdirSync(current);
  }
}

export function buildBundle(input: { projectPath: string; documents: SourceDocument[]; markdownOf: MarkdownOf; renamed?: Renamed; now?: string }): { written: number; removed: number } {
  const { projectPath, documents } = input;
  const now = input.now || new Date().toISOString();
  const types = readTypes(projectPath);
  const graphTypes = readGraphTypes(projectPath);
  const stored = readBundle(projectPath);
  const existing = renamedConcepts(stored, input.renamed);
  const inGraph = documents.filter((document) => graphTypes.includes(typeOf(document.resource, types)));
  const entries: Array<{ id: string; frontmatter: Frontmatter }> = [];
  let written = 0;

  for (const document of documents) {
    const id = conceptId(document.resource);
    const previous = existing.get(id);
    const markdown = inGraph.includes(document) ? input.markdownOf(document.resource) : null;
    const relations = mergedRelations(previous ? relationsOf(previous.frontmatter) : {}, markdown ? scanRelations(document, inGraph, markdown) : []);
    const generated = previous?.frontmatter.generated as { by?: unknown; at?: unknown } | undefined;
    const frontmatter: Frontmatter = {
      ...previous?.frontmatter,
      type: typeOf(document.resource, types),
      title: document.title,
      description: [document.nature, document.date].filter(Boolean).join(' du ') || document.title,
      resource: document.resource,
      date: document.date,
      generated: generated?.by === SCAN_ACTOR && generated.at ? generated : { by: SCAN_ACTOR, at: now },
      relations,
    };
    if (!document.date) delete frontmatter.date;
    if (!Object.keys(relations).length) delete frontmatter.relations;
    const body = atomsBody(document.atoms);
    const filePath = conceptFile(projectPath, id);
    const unchanged = fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === serializeConcept(frontmatter, body);
    if (!unchanged) {
      frontmatter.generated = { by: SCAN_ACTOR, at: now };
      writeIfChanged(filePath, serializeConcept(frontmatter, body));
      written += 1;
    }
    entries.push({ id, frontmatter });
  }

  const kept = new Set(entries.map((entry) => entry.id));
  const stale = stored.filter((concept) => !kept.has(concept.id));
  for (const concept of stale) {
    const filePath = conceptFile(projectPath, concept.id);
    fs.rmSync(filePath, { force: true });
    pruneEmptyDirectories(path.dirname(filePath), bundleRoot(projectPath));
  }
  if (writeIfChanged(path.join(bundleRoot(projectPath), 'index.md'), indexContent(entries, types))) written += 1;
  return { written, removed: stale.length };
}
