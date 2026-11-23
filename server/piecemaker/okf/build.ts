import fs from 'node:fs';
import path from 'node:path';

import { REVIEW_FOLDER, documentTitle, isCellFilled } from '../../../plugins/piecemaker-tabular-review/src/shared.js';
import type { Review } from '../../../plugins/piecemaker-tabular-review/src/shared.js';
import type { KnowledgeSnapshot } from '../../../plugins/piecemaker-dossier/src/types.js';

import type { Frontmatter, Relation, Relations } from './bundle.js';
import {
  AGENT_ACTOR,
  OKF_VERSION,
  SCAN_ACTOR,
  UNCLASSIFIED,
  bundleRoot,
  conceptFile,
  conceptId,
  fold,
  isEntityId,
  migratedId,
  partyId,
  readBundle,
  readTypes,
  relationsOf,
  resourceOf,
  serializeConcept,
  squash,
  text,
  typeOf,
  writeIfChanged,
} from './bundle.js';
import { LEGAL_DOCUMENT, MATERIAL_ENTITY, lofId, lofLabel, lofTerm } from './lof.js';
import { EXAMINED, REVIEWS } from './premises.js';
import { documentMetadataFromReviews, reviewRowPieces } from './reviews.js';
import type { OkfRecords, StoredReviewLink } from './store.js';

export type PartyMention = { code: string; citation: string };
export type SourceDocument = { resource: string; title: string; nature: string; date: string; parties: PartyMention[]; updatedAt?: string };
export type SourceParty = { code: string; side: string; updatedAt?: string };
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
    .map((node) => ({ code: node.id.slice('entity:'.length), side: String(node.data.partySide), updatedAt: node.updatedAt }))
    .sort((left, right) => left.code.localeCompare(right.code));
}

export function documentsFromSnapshot(projectPath: string, snapshot: KnowledgeSnapshot): SourceDocument[] {
  const metadata = documentMetadataFromReviews(projectPath);
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
    documents.set(resource, { resource, title: metadata.get(resource)?.title || node.label, nature: text(node.data.nature) || metadata.get(resource)?.nature || '', date: text(node.date), parties: [...parties.values()], updatedAt: node.updatedAt });
  }
  return [...documents.values()].sort((left, right) => left.resource.localeCompare(right.resource));
}

/** Date ISO d'une cellule Date de l'Index : « 2021-03-12 », « 12/03/2021 » ou « 12 mars 2021 ». */
export function indexDate(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return datesIn(trimmed)[0]?.date ?? '';
}

const NATURE_COLUMNS = ['nature', 'type de document', 'type de pièce', 'type'];
const columnNamed = (review: Review, names: string[]) => review.columns.find((column) => names.includes(String(column?.name ?? '').trim().toLocaleLowerCase('fr').normalize('NFC')));

/** Les pièces de l'Index (SQLite) : une ligne, une pièce, avec le titre, la nature et la date que l'analyse y a portés. */
export function documentsFromIndex(projectPath: string, review: Review | null | undefined): SourceDocument[] {
  if (!review) return [];
  const dateColumn = columnNamed(review, ['date']) ?? review.columns.find((column) => column.format === 'date');
  const natureColumn = columnNamed(review, NATURE_COLUMNS);
  const documents = new Map<string, SourceDocument>();
  for (const row of review.rows) {
    const source = row.piece || row.documents?.[0]?.source || '';
    if (!source || /^https?:/i.test(source)) continue;
    const absolute = path.resolve(projectPath, source);
    if (!fs.existsSync(absolute)) continue;
    const resource = resourceOf(projectPath, absolute);
    if (resource.startsWith('..') || documents.has(resource)) continue;
    const cell = (column: typeof dateColumn) => column ? review.cells?.[row.id]?.[String(column.index)] : undefined;
    const date = cell(dateColumn);
    const nature = cell(natureColumn);
    documents.set(resource, {
      resource,
      title: documentTitle(review, row),
      nature: isCellFilled(nature) ? text(nature.summary) : '',
      date: isCellFilled(date) ? indexDate(date.summary) : '',
      parties: [],
      updatedAt: row.finishedAt || review.updatedAt,
    });
  }
  return [...documents.values()];
}

/** L'Index fait la liste des pièces ; le scan n'y ajoute que ce qu'il sait de plus (parties citées, pièces pas encore indexées). */
export function mergeDocuments(fromIndex: SourceDocument[], fromScan: SourceDocument[]): SourceDocument[] {
  const merged = new Map(fromScan.map((document) => [document.resource, document]));
  for (const document of fromIndex) {
    const scanned = merged.get(document.resource);
    merged.set(document.resource, scanned ? { ...document, title: document.title || scanned.title, nature: document.nature || scanned.nature, date: document.date || scanned.date, parties: scanned.parties } : document);
  }
  return [...merged.values()].sort((left, right) => left.resource.localeCompare(right.resource));
}

function storedRelations(records: OkfRecords, source: string): Relations {
  const relations: Relations = {};
  for (const entry of records.relations) {
    if (entry.source !== source) continue;
    if (!lofTerm(entry.relation)) continue;
    (relations[lofLabel(entry.relation)] ||= []).push({ target: entry.target, citation: entry.citation, origin: entry.origin, ...(entry.piece ? { piece: entry.piece } : {}), ...(entry.value ? { value: entry.value } : {}), ...(entry.at ? { at: entry.at } : {}), ...(entry.dismissed ? { dismissed: true } : {}) });
  }
  return relations;
}

function liveRelations(stored: Relations): Relations {
  const relations: Relations = {};
  for (const [name, entries] of Object.entries(stored)) {
    const live = entries.filter((entry) => !entry.dismissed).sort((left, right) => left.target.localeCompare(right.target));
    if (live.length) relations[name] = live;
  }
  return relations;
}

function indexContent(entries: Array<{ id: string; frontmatter: Frontmatter }>, types: string[]): string {
  const classes = [...new Set(entries.map((entry) => text(entry.frontmatter.type)))].filter((type) => type && !types.includes(type) && type !== UNCLASSIFIED).sort();
  const sections = [...types, UNCLASSIFIED, ...classes].flatMap((type) => {
    const lines = entries
      .filter((entry) => entry.frontmatter.type === type)
      .map((entry) => `* [${text(entry.frontmatter.title)}](${encodeURI(entry.id)}) - ${text(entry.frontmatter.description)}`);
    return lines.length ? [`# ${type}\n\n${lines.join('\n')}`] : [];
  });
  return `---\nokf_version: "${OKF_VERSION}"\n---\n\n${sections.join('\n\n')}\n`;
}

function backlinksBody(id: string, concepts: Array<{ id: string; frontmatter: Frontmatter }>): string {
  const title = (target: string) => text(concepts.find((concept) => concept.id === target)?.frontmatter.title) || target;
  const sections = concepts.flatMap((concept) => Object.entries(relationsOf(concept.frontmatter)).flatMap(([relation, entries]) => entries
    .filter((entry) => entry.target === id && !entry.dismissed)
    .map((entry) => [`## [${text(concept.frontmatter.title)}](${encodeURI(concept.id)}) ${relation}`, ...(entry.piece && entry.piece !== concept.id ? [`Pièce : [${title(entry.piece)}](${encodeURI(entry.piece)})`] : []), ...(entry.value ? [`Valeur : ${entry.value}`] : []), `> ${entry.citation}`].join('\n\n'))));
  return sections.length ? ['# Relations entrantes', ...sections].join('\n\n') : '';
}

export const AUTHOR_LABELS: Record<string, string> = { human: 'vérifiée par l’avocat', agent: 'agent, non vérifiée' };

function reviewsBody(projectPath: string, links: StoredReviewLink[]): string {
  const sections = links.map((link) => {
    const { titre, question, lignes, erreur } = reviewRowPieces(projectPath, link.file, link.column);
    const rows = lignes.map((row) => [`* [${row.label}](${encodeURI(conceptId(row.resource))}) : ${row.value} (${AUTHOR_LABELS[row.author]})`, ...(row.citation ? [`  > ${row.citation}`] : [])].join('\n'));
    return [`## ${titre} › ${question || `colonne ${link.column}`}`, `Revue : ${REVIEW_FOLDER}/${link.file}`, ...(erreur ? [`⚠ ${erreur}`] : rows.length ? [rows.join('\n')] : ['Aucune ligne positive.'])].join('\n\n');
  });
  return sections.length ? ['# Revues tabulaires', ...sections].join('\n\n') : '';
}

function pruneEmptyDirectories(directory: string, root: string): void {
  for (let current = directory; current.startsWith(root) && current !== root; current = path.dirname(current)) {
    if (fs.readdirSync(current).length) return;
    fs.rmdirSync(current);
  }
}

/** Authoritative parts of fiches written before SQLite held them, for a one-time import. Relations outside LOF are not imported. */
export function legacyRecords(projectPath: string): OkfRecords {
  const records: OkfRecords = { premises: [], relations: [], exams: [], reviews: [] };
  for (const concept of readBundle(projectPath)) {
    if (concept.error) continue;
    const id = migratedId(concept.id);
    const generated = (concept.frontmatter.generated || {}) as Record<string, unknown>;
    if (isEntityId(id)) records.premises.push({ id, title: text(concept.frontmatter.title), description: text(concept.frontmatter.description), single: false, by: text(generated.by) || AGENT_ACTOR, at: text(generated.at), lofClass: lofId(text(concept.frontmatter.lof), ['class']) || '' });
    for (const [relation, entries] of Object.entries(relationsOf(concept.frontmatter))) {
      const property = lofId(relation, ['objprop', 'dataprop']);
      if (!property) continue;
      for (const entry of entries) {
        if (entry.origin === SCAN_ACTOR && !entry.dismissed) continue;
        records.relations.push({ source: id, relation: property, target: migratedId(entry.target), citation: entry.citation, value: entry.value || '', origin: entry.origin || AGENT_ACTOR, at: entry.at || text(generated.at), dismissed: entry.dismissed === true, piece: entry.piece || '' });
      }
    }
    const exam = concept.frontmatter[EXAMINED] as Record<string, unknown> | undefined;
    if (exam && text(exam.motif)) records.exams.push({ source: id, motif: text(exam.motif), by: text(exam.by) || AGENT_ACTOR, at: text(exam.at), empreinte: text(exam.empreinte) });
  }
  return records;
}

/** Writes the fiches of the case from SQLite: documents and parties from the knowledge base, LOF fiches, links and examinations from the OKF tables. Every fiche is a view: files not produced here are removed. */
export function buildBundle(input: { projectPath: string; documents: SourceDocument[]; markdownOf: MarkdownOf; parties?: SourceParty[]; records?: OkfRecords; now?: string }): { written: number; removed: number } {
  const { projectPath, documents } = input;
  const parties = input.parties || [];
  const records: OkfRecords = input.records || { premises: [], relations: [], exams: [] };
  const now = input.now || new Date().toISOString();
  const types = readTypes(projectPath);
  const stored = readBundle(projectPath);
  const pending: Array<{ id: string; frontmatter: Frontmatter; by: string; at: string; reviews?: StoredReviewLink[] }> = [];
  const previousAt = new Map(stored.map((concept) => [concept.id, text((concept.frontmatter.generated as Record<string, unknown> | undefined)?.at)]));
  const latest = (...values: string[]): string => values.filter(Boolean).sort().at(-1) || '';
  const exams = new Map(records.exams.map((exam) => [exam.source, exam]));
  const ownAt = (relations: Relations) => Object.values(relations).flat().map((entry) => entry.at || '');

  for (const document of documents) {
    const id = conceptId(document.resource);
    const relations = liveRelations(storedRelations(records, id));
    const exam = exams.get(id);
    pending.push({ id, by: SCAN_ACTOR, at: latest(document.updatedAt || '', ...ownAt(relations), exam?.at || ''), frontmatter: {
      type: typeOf(document.resource, types, projectPath),
      title: document.title,
      nature: document.nature,
      lof: lofId(document.nature, ['class']) || LEGAL_DOCUMENT,
      description: [document.nature, document.date].filter(Boolean).join(' du ') || document.title,
      resource: document.resource,
      ...(document.date ? { date: document.date } : {}),
      ...(Object.keys(relations).length ? { relations } : {}),
      ...(exam ? { [EXAMINED]: { motif: exam.motif, by: exam.by, at: exam.at, empreinte: exam.empreinte } } : {}),
    } });
  }
  for (const entity of records.premises) {
    const relations = liveRelations(storedRelations(records, entity.id));
    const reviews = (records.reviews || []).filter((link) => link.premise === entity.id);
    const classId = lofTerm(entity.lofClass || '')?.kind === 'class' ? entity.lofClass as string : '';
    pending.push({ id: entity.id, by: entity.by, reviews, at: latest(entity.at, ...ownAt(relations), ...reviews.map((link) => link.at)), frontmatter: {
      type: classId ? lofLabel(classId) : UNCLASSIFIED,
      ...(classId ? { lof: classId } : {}),
      title: entity.title,
      description: entity.description || entity.title,
      ...(Object.keys(relations).length ? { relations } : {}),
      ...(reviews.length ? { [REVIEWS]: reviews.map((link) => ({ fichier: link.file, colonne: link.column, by: link.by, at: link.at })) } : {}),
    } });
  }
  for (const party of parties) {
    const id = partyId(party.code);
    const relations = liveRelations(storedRelations(records, id));
    pending.push({ id, by: SCAN_ACTOR, at: latest(party.updatedAt || '', ...ownAt(relations)), frontmatter: {
      type: lofLabel(MATERIAL_ENTITY),
      lof: MATERIAL_ENTITY,
      title: party.code,
      description: party.side === 'client' ? 'Partie cliente' : 'Partie adverse',
      side: party.side,
      ...(Object.keys(relations).length ? { relations } : {}),
    } });
  }

  let written = 0;
  for (const entry of pending) {
    const body = [backlinksBody(entry.id, pending), entry.reviews ? reviewsBody(projectPath, entry.reviews) : ''].filter(Boolean).join('\n\n');
    entry.frontmatter.generated = { by: entry.by, at: entry.at || previousAt.get(entry.id) || now };
    if (writeIfChanged(conceptFile(projectPath, entry.id), serializeConcept(entry.frontmatter, body))) written += 1;
  }

  const kept = new Set(pending.map((entry) => entry.id));
  const stale = stored.filter((concept) => !kept.has(concept.id));
  for (const concept of stale) {
    const filePath = conceptFile(projectPath, concept.id);
    fs.rmSync(filePath, { force: true });
    pruneEmptyDirectories(path.dirname(filePath), bundleRoot(projectPath));
  }
  if (writeIfChanged(path.join(bundleRoot(projectPath), 'index.md'), indexContent(pending, types))) written += 1;
  return { written, removed: stale.length };
}
