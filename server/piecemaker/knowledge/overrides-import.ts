import fs from 'node:fs';
import path from 'node:path';

import { splitDocumentDate } from '../../../plugins/piecemaker-dossier/src/knowledge.js';
import type { KnowledgeStore } from '../../../plugins/piecemaker-dossier/src/knowledge.js';
import type { JsonData, KnowledgeNode, KnowledgeUpdateOperation } from '../../../plugins/piecemaker-dossier/src/types.js';

type ProjectRow = { project_id: string; project_path: string };

type OverridesImportOptions = {
  listProjects(): ProjectRow[];
  warn?(message: string): void;
};

type OverrideEntry = { nature: string | null; dateIso: unknown; localisation: string | null; fields: Array<{ label: string; value: string }> };
type DecisionEntry = { additions: string[]; exclusions: string[] };

const KEY_PATTERN = /^[a-f0-9]{64}$/;
const LEGACY_FILE = ['.piecemaker', 'document-index-overrides.json'];
const INDEX_FILE = ['.piecemaker', 'document-index.json'];
const IMPORTED_ROOTS = ['overrides', 'entityDecisions', 'revisions'];

const isRecord = (value: unknown): value is JsonData => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number): string | null => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

function readJson(file: string): JsonData | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function keyed(source: unknown): Array<[string, JsonData]> {
  return isRecord(source) ? Object.entries(source).filter((entry): entry is [string, JsonData] => KEY_PATTERN.test(entry[0].toLowerCase()) && isRecord(entry[1])).map(([key, value]) => [key.toLowerCase(), value]) : [];
}

function overrideEntry(source: JsonData): OverrideEntry {
  const fields = (Array.isArray(source.fields) ? source.fields : [])
    .filter(isRecord)
    .map((field) => ({ label: text(field.label, 120) ?? '', value: text(field.value, 400) ?? '' }))
    .filter((field) => field.label || field.value)
    .slice(0, 24);
  return { nature: text(source.nature, 120), dateIso: typeof source.dateIso === 'string' ? source.dateIso.trim() : null, localisation: text(source.localisation, 200), fields };
}

function decisionEntry(source: JsonData): DecisionEntry {
  const codes = (values: unknown): string[] => [...new Set((Array.isArray(values) ? values : []).map((value) => text(value, 160)).filter((value): value is string => Boolean(value)))];
  return { additions: codes(source.additions), exclusions: codes(source.exclusions) };
}

const isEmptyOverride = (entry: OverrideEntry): boolean => entry.nature === null && !entry.dateIso && entry.localisation === null && entry.fields.length === 0;

function metadataOperation(node: KnowledgeNode, entry: OverrideEntry): KnowledgeUpdateOperation | null {
  const data: JsonData = { ...node.data };
  if (entry.nature) data.nature = entry.nature;
  if (entry.localisation) data.localisation = entry.localisation;
  if (entry.fields.length) data.fields = entry.fields;
  let date: string | null | undefined;
  if (entry.dateIso) {
    const split = splitDocumentDate({ doc_date_iso: entry.dateIso });
    date = split.date;
    if (split.date) delete data.date_non_reconnue;
    else data.date_non_reconnue = split.data.date_non_reconnue;
  }
  if (JSON.stringify(data) === JSON.stringify(node.data) && (date === undefined || date === node.date)) return null;
  return { op: 'upsertNode', node: { id: node.id, kind: 'document', label: node.label, aliases: node.aliases, data, ...(date === undefined ? {} : { date }) } };
}

function decisionOperations(documentId: string, decision: DecisionEntry, entityIds: Set<string>): KnowledgeUpdateOperation[] {
  const operations: KnowledgeUpdateOperation[] = [];
  const relation = 'mentions';
  for (const code of decision.exclusions) {
    const entityId = `entity:${code}`;
    if (!entityIds.has(entityId)) continue;
    operations.push({ op: 'unlink', link: { fromNodeId: documentId, toNodeId: entityId, relation } });
    operations.push({ op: 'excludeLink', exclusion: { piece: documentId, entite: entityId, relation } });
  }
  for (const code of decision.additions) {
    const entityId = `entity:${code}`;
    if (entityIds.has(entityId) && !decision.exclusions.includes(code)) operations.push({ op: 'link', link: { fromNodeId: documentId, toNodeId: entityId, relation, data: {} } });
  }
  return operations;
}

function writeAtomically(file: string, content: JsonData): void {
  const temporary = `${file}.piecemaker-${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(content)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function importProject(store: KnowledgeStore, project: ProjectRow): number {
  const indexFile = path.join(project.project_path, ...INDEX_FILE);
  const legacyFile = path.join(project.project_path, ...LEGACY_FILE);
  const index = readJson(indexFile);
  const legacy = readJson(legacyFile);
  const legacyEntries = keyed(legacy?.documents);
  const hasWork = IMPORTED_ROOTS.some((root) => index && root in index) || fs.existsSync(legacyFile);
  if (!hasWork) return 0;
  const overrides = new Map<string, JsonData>([...legacyEntries, ...keyed(index?.overrides)]);
  const decisions = new Map<string, JsonData>(keyed(index?.entityDecisions));
  const snapshot = store.snapshot(project.project_id);
  const documents = new Map(snapshot.nodes.filter((node) => node.kind === 'document').map((node) => [node.id, node]));
  const entityIds = new Set(snapshot.nodes.filter((node) => node.kind !== 'document').map((node) => node.id));
  const operations: KnowledgeUpdateOperation[] = [];
  const pendingOverrides: Record<string, JsonData> = {};
  const pendingDecisions: Record<string, JsonData> = {};
  for (const [key, raw] of overrides) {
    const node = documents.get(`document:${key}`);
    const entry = overrideEntry(raw);
    if (isEmptyOverride(entry)) continue;
    if (!node) {
      pendingOverrides[key] = raw;
      continue;
    }
    const operation = metadataOperation(node, entry);
    if (operation) operations.push(operation);
  }
  for (const [key, raw] of decisions) {
    const documentId = `document:${key}`;
    if (!documents.has(documentId)) {
      pendingDecisions[key] = raw;
      continue;
    }
    operations.push(...decisionOperations(documentId, decisionEntry(raw), entityIds));
  }
  if (operations.length) store.update({ projectId: project.project_id, operations });
  const remaining: JsonData = { ...(index ?? { version: 2, documents: {} }) };
  for (const root of IMPORTED_ROOTS) delete remaining[root];
  if (Object.keys(pendingOverrides).length) remaining.overrides = pendingOverrides;
  if (Object.keys(pendingDecisions).length) remaining.entityDecisions = pendingDecisions;
  const hasPending = Boolean(remaining.overrides || remaining.entityDecisions);
  if (index ? JSON.stringify(remaining) !== JSON.stringify(index) : hasPending) writeAtomically(indexFile, remaining);
  if (fs.existsSync(legacyFile)) fs.unlinkSync(legacyFile);
  return operations.length;
}

export function importDocumentIndexOverrides(store: KnowledgeStore, options: OverridesImportOptions): number {
  const warn = options.warn ?? ((message: string) => console.warn(message));
  let applied = 0;
  for (const project of options.listProjects()) {
    try {
      applied += importProject(store, project);
    } catch (error) {
      warn(`[piecemaker] import des corrections de pièces impossible pour ${project.project_path} : ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return applied;
}
