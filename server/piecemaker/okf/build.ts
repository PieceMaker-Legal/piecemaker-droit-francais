import fs from 'node:fs';
import path from 'node:path';

import { sentenceContaining } from '../../../plugins/piecemaker-dossier/src/excerpt.js';
import type { KnowledgeSnapshot } from '../../../plugins/piecemaker-dossier/src/types.js';

import type { Concept, Frontmatter, Relation, Relations } from './bundle.js';
import {
  AGENT_ACTOR,
  DERIVED_ACTORS,
  PREMISE_TYPE,
  MENTIONS,
  OKF_VERSION,
  PARTY_TYPE,
  RELATIONS,
  REVIEW_ACTOR,
  SCAN_ACTOR,
  STATES,
  UNCLASSIFIED,
  bundleRoot,
  conceptFile,
  conceptId,
  fold,
  migratedId,
  partyId,
  readBundle,
  readGraphTypes,
  readTypes,
  relationsOf,
  resourceOf,
  serializeConcept,
  squash,
  text,
  typeOf,
  writeIfChanged,
} from './bundle.js';
import type { ReviewPremise } from './reviews.js';
import { quoted } from './verify.js';

export type PartyMention = { code: string; citation: string };
export type SourceDocument = { resource: string; title: string; nature: string; date: string; parties: PartyMention[] };
export type SourceParty = { code: string; side: string };
export type MarkdownOf = (resource: string) => string | null;
export type Renamed = { previous: string; current: string };

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const WRITTEN_DATE = /(\d{1,2})(?:er)?\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre)\s+(\d{4})/gi;
const NUMERIC_DATE = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g;

const iso = (year: string, month: number, day: string): string => `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;

export function datesIn(line: string): Array<{ literal: string; date: string }> {
  return [
    ...[...line.matchAll(WRITTEN_DATE)].map((match) => ({ literal: match[0], date: iso(match[3], MONTHS.indexOf(fold(match[2])) + 1, match[1]) })),
    ...[...line.matchAll(NUMERIC_DATE)].map((match) => ({ literal: match[0], date: iso(match[3], Number(match[2]), match[1]) })),
  ];
}

export function partiesFromSnapshot(snapshot: KnowledgeSnapshot): SourceParty[] {
  return snapshot.nodes
    .filter((node) => node.id.startsWith('entity:') && (node.data.partySide === 'client' || node.data.partySide === 'adversaire'))
    .map((node) => ({ code: node.id.slice('entity:'.length), side: String(node.data.partySide) }))
    .sort((left, right) => left.code.localeCompare(right.code));
}

export function documentsFromSnapshot(projectPath: string, snapshot: KnowledgeSnapshot): SourceDocument[] {
  const partyCodes = new Set(partiesFromSnapshot(snapshot).map((party) => party.code));
  const documents = new Map<string, SourceDocument>();
  for (const node of snapshot.nodes) {
    const filePath = text(node.data.path);
    if (node.kind !== 'document' || !filePath || !fs.existsSync(filePath)) continue;
    const resource = resourceOf(projectPath, filePath);
    if (resource.startsWith('..')) continue;
    const parties = new Map<string, PartyMention>();
    for (const citation of snapshot.citations) {
      const code = citation.toNodeId.slice('entity:'.length);
      if (citation.fromNodeId !== node.id || !citation.toNodeId.startsWith('entity:') || !citation.texte || !partyCodes.has(code) || parties.has(code)) continue;
      parties.set(code, { code, citation: squash(citation.texte) });
    }
    documents.set(resource, { resource, title: node.label, nature: text(node.data.nature), date: text(node.date), parties: [...parties.values()] });
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
      const target = conceptId(matching[0].resource);
      if (!found.has(target)) found.set(target, { target, citation: sentence, origin: SCAN_ACTOR });
    }
  }
  return [...found.values()];
}

function renamedConcepts(concepts: Concept[], renamed?: Renamed): Map<string, Concept> {
  const from = renamed ? conceptId(renamed.previous) : '';
  const to = renamed ? conceptId(renamed.current) : '';
  const move = (id: string): string => id === from ? to : migratedId(id);
  return new Map(concepts.filter((concept) => !concept.error).map((concept) => {
    const relations = relationsOf(concept.frontmatter);
    for (const entries of Object.values(relations)) for (const entry of entries) entry.target = move(entry.target);
    return [move(concept.id), { ...concept, id: move(concept.id), frontmatter: { ...concept.frontmatter, relations } }];
  }));
}

function mergedRelations(existing: Relations, derived: Relations, livePremises: Set<string>): Relations {
  const relations: Relations = {};
  for (const [name, entries] of Object.entries(existing)) {
    const kept = entries.filter((entry) => name !== MENTIONS && (!DERIVED_ACTORS.includes(entry.origin) || entry.dismissed) && (name !== STATES || livePremises.has(entry.target)));
    if (kept.length) relations[name] = kept;
  }
  const linkedDocuments = new Set(RELATIONS.flatMap((name) => relations[name] || []).map((entry) => entry.target));
  for (const [name, entries] of Object.entries(derived)) {
    const known = name === 'refers-to' ? linkedDocuments : new Set((relations[name] || []).map((entry) => entry.target));
    const added = entries.filter((entry) => !known.has(entry.target));
    if (added.length) relations[name] = [...(relations[name] || []), ...added];
  }
  for (const entries of Object.values(relations)) entries.sort((left, right) => left.target.localeCompare(right.target));
  return relations;
}

function indexContent(entries: Array<{ id: string; frontmatter: Frontmatter }>, types: string[]): string {
  const sections = [...types, UNCLASSIFIED, PREMISE_TYPE, PARTY_TYPE].flatMap((type) => {
    const lines = entries
      .filter((entry) => entry.frontmatter.type === type)
      .map((entry) => `* [${text(entry.frontmatter.title)}](${encodeURI(entry.id)}) - ${text(entry.frontmatter.description)}`);
    return lines.length ? [`# ${type}\n\n${lines.join('\n')}`] : [];
  });
  return `---\nokf_version: "${OKF_VERSION}"\n---\n\n${sections.join('\n\n')}\n`;
}

function backlinksBody(id: string, relation: string, documents: Array<{ id: string; frontmatter: Frontmatter }>): string {
  const sections = documents.flatMap((document) => (relationsOf(document.frontmatter)[relation] || [])
    .filter((entry) => entry.target === id && !entry.dismissed)
    .map((entry) => [`## [${text(document.frontmatter.title)}](${encodeURI(document.id)})`, ...(entry.value ? [`Valeur : ${entry.value}`] : []), `> ${entry.citation}`].join('\n\n')));
  return sections.length ? ['# Pièces', ...sections].join('\n\n') : '';
}

function pruneEmptyDirectories(directory: string, root: string): void {
  for (let current = directory; current.startsWith(root) && current !== root; current = path.dirname(current)) {
    if (fs.readdirSync(current).length) return;
    fs.rmdirSync(current);
  }
}

export function buildBundle(input: { projectPath: string; documents: SourceDocument[]; markdownOf: MarkdownOf; parties?: SourceParty[]; reviewPremises?: ReviewPremise[]; renamed?: Renamed; now?: string }): { written: number; removed: number } {
  const { projectPath, documents } = input;
  const parties = input.parties || [];
  const reviewPremises = input.reviewPremises || [];
  const now = input.now || new Date().toISOString();
  const types = readTypes(projectPath);
  const graphTypes = readGraphTypes(projectPath);
  const stored = readBundle(projectPath);
  const existing = renamedConcepts(stored, input.renamed);
  const inGraph = documents.filter((document) => graphTypes.includes(typeOf(document.resource, types)));
  const entries: Array<{ id: string; frontmatter: Frontmatter }> = [];
  let written = 0;

  const markdownCache = new Map<string, string | null>();
  const markdown = (resource: string): string | null => {
    if (!markdownCache.has(resource)) markdownCache.set(resource, input.markdownOf(resource));
    return markdownCache.get(resource) as string | null;
  };
  const write = (id: string, frontmatter: Frontmatter, body: string, by: string): void => {
    const generated = existing.get(id)?.frontmatter.generated as { by?: unknown; at?: unknown } | undefined;
    frontmatter.generated = generated?.by && generated.at ? generated : { by, at: now };
    const filePath = conceptFile(projectPath, id);
    if (!fs.existsSync(filePath) || fs.readFileSync(filePath, 'utf8') !== serializeConcept(frontmatter, body)) {
      frontmatter.generated = { by: text(generated?.by) || by, at: now };
      writeIfChanged(filePath, serializeConcept(frontmatter, body));
      written += 1;
    }
    entries.push({ id, frontmatter });
  };

  const byResource = new Map(documents.map((document) => [document.resource, document]));
  const statements = new Map<string, Map<string, Relation>>();
  for (const premise of reviewPremises) {
    for (const statement of premise.statements) {
      const named = statement.candidates.map((candidate) => byResource.get(candidate)).find(Boolean);
      const quoting = named ? [] : documents.filter((document) => quoted(markdown(document.resource), statement.quote));
      const document = named || (quoting.length === 1 ? quoting[0] : undefined);
      if (!document || !quoted(markdown(document.resource), statement.quote)) continue;
      const links = statements.get(document.resource) || new Map<string, Relation>();
      links.set(premise.id, { target: premise.id, citation: statement.quote, origin: REVIEW_ACTOR, ...(statement.value ? { value: statement.value } : {}) });
      statements.set(document.resource, links);
    }
  }

  const documentIds = new Set(documents.map((document) => conceptId(document.resource)));
  const livePremises = new Set(reviewPremises.map((premise) => premise.id));
  for (const [id, concept] of existing) {
    if (!documentIds.has(id)) continue;
    for (const entry of relationsOf(concept.frontmatter)[STATES] || []) {
      if (!entry.dismissed && !DERIVED_ACTORS.includes(entry.origin) && existing.has(entry.target)) livePremises.add(entry.target);
    }
  }
  const partyCodes = new Set(parties.map((party) => party.code));

  for (const document of documents) {
    const id = conceptId(document.resource);
    const previous = existing.get(id);
    const derived: Relations = {
      'refers-to': inGraph.includes(document) && markdown(document.resource) ? scanRelations(document, inGraph, markdown(document.resource) as string) : [],
      [MENTIONS]: document.parties.filter((party) => partyCodes.has(party.code)).map((party) => ({ target: partyId(party.code), citation: party.citation, origin: SCAN_ACTOR })),
      [STATES]: [...(statements.get(document.resource)?.values() || [])],
    };
    const relations = mergedRelations(previous ? relationsOf(previous.frontmatter) : {}, derived, livePremises);
    const frontmatter: Frontmatter = {
      ...previous?.frontmatter,
      type: typeOf(document.resource, types),
      title: document.title,
      description: [document.nature, document.date].filter(Boolean).join(' du ') || document.title,
      resource: document.resource,
      date: document.date,
      relations,
    };
    if (!document.date) delete frontmatter.date;
    if (!Object.keys(relations).length) delete frontmatter.relations;
    write(id, frontmatter, '', SCAN_ACTOR);
  }
  const documentEntries = [...entries];

  const reviewed = new Map(reviewPremises.map((premise) => [premise.id, premise]));
  for (const id of [...livePremises].sort()) {
    const previous = existing.get(id);
    const premise = reviewed.get(id);
    const frontmatter: Frontmatter = {
      ...previous?.frontmatter,
      type: PREMISE_TYPE,
      title: premise?.title || text(previous?.frontmatter.title),
      description: premise?.description || text(previous?.frontmatter.description) || text(previous?.frontmatter.title),
      ...(premise ? { single_value: premise.single } : {}),
    };
    if (!frontmatter.single_value) delete frontmatter.single_value;
    write(id, frontmatter, backlinksBody(id, STATES, documentEntries), premise ? REVIEW_ACTOR : AGENT_ACTOR);
  }
  for (const party of parties) {
    const id = partyId(party.code);
    write(id, { type: PARTY_TYPE, title: party.code, description: party.side === 'client' ? 'Partie cliente' : 'Partie adverse', side: party.side }, backlinksBody(id, MENTIONS, documentEntries), SCAN_ACTOR);
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
