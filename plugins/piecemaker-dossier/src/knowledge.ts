import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { isInstitutionalEntity } from './institutional-terms.js';

import { EXCLUSIONS_NODE_ID, NODE_KINDS } from './types.js';
import type {
  JsonData,
  KnowledgeCitation,
  KnowledgeCitationInput,
  KnowledgeLinkInput,
  KnowledgeLink,
  KnowledgeMapping,
  KnowledgeNode,
  KnowledgeNodeInput,
  KnowledgeQueryInput,
  KnowledgeQueryResult,
  KnowledgeResolvedLink,
  KnowledgeResolvedNode,
  KnowledgeUpdateInput,
  KnowledgeUpdateOperation,
  KnowledgeUpdateResult,
  KnowledgeSnapshot,
  NodeKind,
} from './types.js';

type DatabaseConnection = InstanceType<typeof Database>;
type NodeRow = { id: string; project_id: string; kind: NodeKind; label: string; aliases_json: string; search_text: string; data_json: string; doc_date: string | null; created_at: string; updated_at: string };
type LinkRow = { from_node_id: string; to_node_id: string; relation: string; data_json: string };
type MappingRow = { project_id: string; node_id: string; real_value: string; masked_value: string; data_json: string };
type CitationRow = { id: number; from_node_id: string; to_node_id: string; relation: string; texte: string; piece_id: string | null; source: string | null; created_at: string };
type Counts = { nodes: number; links: number; mappings: number };
type LoadedGraph = { nodes: Map<string, NodeRow>; links: LinkRow[]; mappings: Map<string, KnowledgeMapping[]> };

const NOW_DEFAULT = "DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))";
const nodesTable = (name: string): string => `CREATE TABLE ${name} (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('person','company','document','iban','address','phone','email','url','siren','other')),
  label TEXT NOT NULL DEFAULT '',
  search_text TEXT NOT NULL DEFAULT '',
  aliases_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases_json)),
  data_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data_json)),
  doc_date TEXT CHECK (doc_date IS NULL OR doc_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at TEXT NOT NULL ${NOW_DEFAULT},
  updated_at TEXT NOT NULL ${NOW_DEFAULT},
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
)`;
const linksTable = (name: string): string => `CREATE TABLE ${name} (
  project_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data_json)),
  created_at TEXT NOT NULL ${NOW_DEFAULT},
  updated_at TEXT NOT NULL ${NOW_DEFAULT},
  PRIMARY KEY (project_id, from_node_id, to_node_id, relation),
  FOREIGN KEY (project_id, from_node_id) REFERENCES piecemaker_nodes(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, to_node_id) REFERENCES piecemaker_nodes(project_id, id) ON DELETE CASCADE
)`;
const mappingsTable = (name: string): string => `CREATE TABLE ${name} (
  project_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  real_value TEXT NOT NULL,
  masked_value TEXT NOT NULL,
  search_text TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data_json)),
  created_at TEXT NOT NULL ${NOW_DEFAULT},
  updated_at TEXT NOT NULL ${NOW_DEFAULT},
  PRIMARY KEY (project_id, node_id, real_value),
  FOREIGN KEY (project_id, node_id) REFERENCES piecemaker_nodes(project_id, id) ON DELETE CASCADE
)`;

const SCHEMA_SQL = `
${nodesTable('IF NOT EXISTS piecemaker_nodes')};
${linksTable('IF NOT EXISTS piecemaker_links')};
${mappingsTable('IF NOT EXISTS piecemaker_mappings')};
CREATE TABLE IF NOT EXISTS piecemaker_citations (
  id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  texte TEXT NOT NULL,
  piece_id TEXT,
  source TEXT,
  created_at TEXT NOT NULL ${NOW_DEFAULT},
  CHECK (piece_id IS NOT NULL OR source IS NOT NULL),
  FOREIGN KEY (project_id, from_node_id, to_node_id, relation) REFERENCES piecemaker_links(project_id, from_node_id, to_node_id, relation) ON DELETE CASCADE,
  FOREIGN KEY (project_id, piece_id) REFERENCES piecemaker_nodes(project_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS piecemaker_anonymization_status (
  project_id TEXT PRIMARY KEY NOT NULL,
  completed_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS piecemaker_nodes_lookup ON piecemaker_nodes(project_id, kind, search_text);
CREATE INDEX IF NOT EXISTS piecemaker_nodes_doc_date ON piecemaker_nodes(project_id, doc_date);
CREATE INDEX IF NOT EXISTS piecemaker_links_from ON piecemaker_links(project_id, from_node_id);
CREATE INDEX IF NOT EXISTS piecemaker_links_to ON piecemaker_links(project_id, to_node_id);
CREATE INDEX IF NOT EXISTS piecemaker_mappings_lookup ON piecemaker_mappings(project_id, search_text);
CREATE INDEX IF NOT EXISTS piecemaker_mappings_masked ON piecemaker_mappings(project_id, masked_value);
CREATE INDEX IF NOT EXISTS piecemaker_citations_link ON piecemaker_citations(project_id, from_node_id, to_node_id, relation);
`;

const at = (): string => new Date().toISOString();
const parseJson = <T>(value: string, fallback: T): T => { try { return JSON.parse(value) as T; } catch { return fallback; } };
const requiredText = (value: unknown, field: string): string => { if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string`); return value.trim(); };
const optionalText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const objectValue = (value: unknown, field: string): JsonData => { if (value === undefined) return {}; if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${field} must be an object`); return value as JsonData; };
const arrayValue = (value: unknown, field: string): string[] => { if (value === undefined) return []; if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw new TypeError(`${field} must be an array of strings`); return [...new Set(value.map((entry) => entry.trim()).filter(Boolean))]; };
const kindValue = (value: unknown): NodeKind => { if (typeof value !== 'string' || !NODE_KINDS.includes(value as NodeKind)) throw new TypeError(`kind must be one of ${NODE_KINDS.join(', ')}`); return value as NodeKind; };
const searchable = (values: string[]): string => values.join('\u0000').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
const nextFreeCode = (code: string, used: Set<string>): string => {
  const match = /^(.*)_(\d+)$/.exec(code);
  const prefix = match ? match[1] : code;
  const width = match && match[2].length > 1 ? match[2].length : 0;
  let highest = 0;
  for (const candidate of used) {
    const numbered = /^(.*)_(\d+)$/.exec(candidate);
    if (numbered && numbered[1] === prefix) highest = Math.max(highest, Number(numbered[2]));
  }
  let number = highest + 1;
  while (used.has(`${prefix}_${String(number).padStart(width, '0')}`)) number += 1;
  return `${prefix}_${String(number).padStart(width, '0')}`;
};
const searchPattern = (value: string): string => `%${searchable([value]).replace(/[\\%_]/g, '\\$&')}%`;
const toNode = (row: NodeRow): KnowledgeNode => ({ id: row.id, projectId: row.project_id, kind: row.kind, label: row.label, aliases: parseJson<string[]>(row.aliases_json, []), data: parseJson<JsonData>(row.data_json, {}), date: row.doc_date, createdAt: row.created_at, updatedAt: row.updated_at });
const withoutInstitutionalAliases = (node: KnowledgeNode): KnowledgeNode => ({ ...node, aliases: node.aliases.filter((alias) => !isInstitutionalEntity(alias)) });
const toCitation = (projectId: string, row: CitationRow): KnowledgeCitation => ({ id: row.id, projectId, fromNodeId: row.from_node_id, toNodeId: row.to_node_id, relation: row.relation, texte: row.texte, pieceId: row.piece_id, source: row.source, createdAt: row.created_at });
const toMapping = (row: MappingRow): KnowledgeMapping => ({ projectId: row.project_id, nodeId: row.node_id, real: row.real_value, masked: row.masked_value, data: parseJson<JsonData>(row.data_json, {}) });

const isDocumentDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const dateValue = (value: unknown): string | null => { if (value === undefined || value === null) return null; if (!isDocumentDate(value)) throw new TypeError('node.date must be formatted YYYY-MM-DD'); return value; };

export function splitDocumentDate(data: JsonData): { date: string | null; data: JsonData } {
  const { doc_date_iso: isoDate, dateIso: legacyDate, ...rest } = data;
  const candidates = [isoDate, legacyDate];
  const date = candidates.find(isDocumentDate) ?? null;
  if (date) return { date, data: rest };
  const unrecognized = candidates.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
  if (unrecognized === undefined) return { date: null, data: rest };
  return { date: null, data: { ...rest, date_non_reconnue: typeof unrecognized === 'string' ? unrecognized : JSON.stringify(unrecognized) } };
}

const hasColumn = (database: DatabaseConnection, table: string, column: string): boolean => (database.pragma(`table_info(${table})`) as Array<{ name: string }>).some(({ name }) => name === column);

function migrateAwayFromOrigin(database: DatabaseConnection): void {
  if (!hasColumn(database, 'piecemaker_nodes', 'origin')) return;
  database.pragma('foreign_keys = OFF');
  try {
    database.transaction(() => {
      database.exec(`${nodesTable('piecemaker_nodes_new')}; ${linksTable('piecemaker_links_new')}; ${mappingsTable('piecemaker_mappings_new')}`);
      const insertNode = database.prepare('INSERT INTO piecemaker_nodes_new(project_id,id,kind,label,search_text,aliases_json,data_json,doc_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
      for (const row of database.prepare('SELECT * FROM piecemaker_nodes').all() as NodeRow[]) {
        const split = splitDocumentDate(parseJson<JsonData>(row.data_json, {}));
        insertNode.run(row.project_id, row.id, row.kind, row.label, row.search_text, row.aliases_json, JSON.stringify(split.data), split.date, row.created_at, row.updated_at);
      }
      database.exec(`INSERT INTO piecemaker_links_new(project_id,from_node_id,to_node_id,relation,data_json,created_at,updated_at) SELECT project_id,from_node_id,to_node_id,relation,data_json,created_at,updated_at FROM piecemaker_links;
        INSERT INTO piecemaker_mappings_new(project_id,node_id,real_value,masked_value,search_text,data_json,created_at,updated_at) SELECT project_id,node_id,real_value,masked_value,search_text,data_json,created_at,updated_at FROM piecemaker_mappings;
        DROP TABLE piecemaker_mappings; DROP TABLE piecemaker_links; DROP TABLE piecemaker_nodes;
        ALTER TABLE piecemaker_nodes_new RENAME TO piecemaker_nodes;
        ALTER TABLE piecemaker_links_new RENAME TO piecemaker_links;
        ALTER TABLE piecemaker_mappings_new RENAME TO piecemaker_mappings;`);
      database.exec(SCHEMA_SQL);
      for (const table of ['piecemaker_nodes', 'piecemaker_links', 'piecemaker_mappings']) {
        if ((database.pragma(`foreign_key_check(${table})`) as unknown[]).length) throw new Error(`origin migration left foreign key violations in ${table}`);
      }
    })();
  } finally {
    database.pragma('foreign_keys = ON');
  }
}

export function resolveKnowledgeDatabasePath(): string {
  return process.env.DATABASE_PATH || path.join(process.env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker'), 'auth.db');
}

export function initializeKnowledgeSchema(database: DatabaseConnection): void {
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  migrateAwayFromOrigin(database);
  database.exec(SCHEMA_SQL);
  database.prepare(`
    INSERT OR IGNORE INTO piecemaker_anonymization_status(project_id, completed_at)
    SELECT DISTINCT project_id, ? FROM piecemaker_mappings
  `).run(at());
}

export class KnowledgeStore {
  private readonly database: DatabaseConnection;
  private readonly ownsDatabase: boolean;
  private readonly findRoots;
  private readonly findProject;
  private readonly upsertNode;
  private readonly upsertLink;
  private readonly addLinkIfAbsent;
  private readonly deleteLink;
  private readonly upsertMapping;
  private readonly addMappingIfAbsent;
  private readonly deleteMapping;
  private readonly addCitation;
  private readonly removePartyDesignation;
  private readonly deleteNode;
  private readonly findCodeOwner;

  public constructor(databaseSource: string | DatabaseConnection = resolveKnowledgeDatabasePath()) {
    this.ownsDatabase = typeof databaseSource === 'string';
    if (typeof databaseSource === 'string') fs.mkdirSync(path.dirname(databaseSource), { recursive: true, mode: 0o700 });
    this.database = typeof databaseSource === 'string' ? new Database(databaseSource) : databaseSource;
    initializeKnowledgeSchema(this.database);
    this.findRoots = this.database.prepare(`SELECT DISTINCT n.* FROM piecemaker_nodes n LEFT JOIN piecemaker_mappings m ON m.project_id=n.project_id AND m.node_id=n.id WHERE n.project_id=@projectId AND n.id NOT LIKE 'system:%' AND (@kind IS NULL OR n.kind=@kind) AND (@pattern='' OR n.search_text LIKE @pattern ESCAPE '\\' OR m.search_text LIKE @pattern ESCAPE '\\') ORDER BY CASE WHEN n.search_text=@exact THEN 0 ELSE 1 END,n.label,n.id LIMIT @limit`);
    this.findProject = this.database.prepare('SELECT project_id FROM projects WHERE project_id=@value OR project_path=@value LIMIT 1');
    this.upsertNode = this.database.prepare(`INSERT INTO piecemaker_nodes(project_id,id,kind,label,search_text,aliases_json,data_json,doc_date,created_at,updated_at) VALUES(@projectId,@id,@kind,@label,@searchText,@aliases,@data,@date,@at,@at) ON CONFLICT(project_id,id) DO UPDATE SET kind=excluded.kind,label=excluded.label,search_text=excluded.search_text,aliases_json=excluded.aliases_json,data_json=excluded.data_json,doc_date=CASE WHEN @dateGiven THEN excluded.doc_date ELSE piecemaker_nodes.doc_date END,updated_at=excluded.updated_at`);
    this.upsertLink = this.database.prepare(`INSERT INTO piecemaker_links(project_id,from_node_id,to_node_id,relation,data_json,created_at,updated_at) VALUES(@projectId,@fromNodeId,@toNodeId,@relation,@data,@at,@at) ON CONFLICT(project_id,from_node_id,to_node_id,relation) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at`);
    this.addLinkIfAbsent = this.database.prepare(`INSERT INTO piecemaker_links(project_id,from_node_id,to_node_id,relation,data_json,created_at,updated_at) VALUES(@projectId,@fromNodeId,@toNodeId,@relation,@data,@at,@at) ON CONFLICT(project_id,from_node_id,to_node_id,relation) DO NOTHING`);
    this.deleteLink = this.database.prepare('DELETE FROM piecemaker_links WHERE project_id=@projectId AND from_node_id=@fromNodeId AND to_node_id=@toNodeId AND relation=@relation');
    this.upsertMapping = this.database.prepare(`INSERT INTO piecemaker_mappings(project_id,node_id,real_value,masked_value,search_text,data_json,created_at,updated_at) VALUES(@projectId,@nodeId,@real,@masked,@searchText,@data,@at,@at) ON CONFLICT(project_id,node_id,real_value) DO UPDATE SET masked_value=excluded.masked_value,search_text=excluded.search_text,data_json=excluded.data_json,updated_at=excluded.updated_at`);
    this.addMappingIfAbsent = this.database.prepare(`INSERT INTO piecemaker_mappings(project_id,node_id,real_value,masked_value,search_text,data_json,created_at,updated_at) VALUES(@projectId,@nodeId,@real,@masked,@searchText,@data,@at,@at) ON CONFLICT(project_id,node_id,real_value) DO NOTHING`);
    this.deleteMapping = this.database.prepare('DELETE FROM piecemaker_mappings WHERE project_id=@projectId AND node_id=@nodeId AND real_value=@real');
    this.addCitation = this.database.prepare(`INSERT INTO piecemaker_citations(project_id,from_node_id,to_node_id,relation,texte,piece_id,source) SELECT @projectId,@fromNodeId,@toNodeId,@relation,@texte,@pieceId,@source WHERE NOT EXISTS (SELECT 1 FROM piecemaker_citations WHERE project_id=@projectId AND from_node_id=@fromNodeId AND to_node_id=@toNodeId AND relation=@relation AND texte=@texte AND piece_id IS @pieceId AND source IS @source)`);
    this.removePartyDesignation = this.database.prepare("UPDATE piecemaker_nodes SET data_json=json_remove(data_json, '$.partySide', '$.position'), updated_at=@at WHERE project_id=@projectId AND id=@nodeId");
    this.deleteNode = this.database.prepare('DELETE FROM piecemaker_nodes WHERE project_id=@projectId AND id=@nodeId');
    this.findCodeOwner = this.database.prepare(`SELECT project_id FROM piecemaker_mappings WHERE masked_value=@code AND project_id<>@projectId
      UNION SELECT project_id FROM piecemaker_nodes WHERE id='entity:'||@code AND project_id<>@projectId LIMIT 1`);
    this.database.transaction(() => this.renumberConflictingCodes())();
    if (typeof databaseSource === 'string') {
      try { fs.chmodSync(databaseSource, 0o600); } catch {}
    }
  }

  public query(input: KnowledgeQueryInput): KnowledgeQueryResult {
    const projectId = this.resolveProject(input.projectId || input.projectPath);
    const query = optionalText(input.query);
    const depth = Math.max(0, Math.min(12, Number.isFinite(input.depth) ? Math.floor(input.depth as number) : 3));
    const limit = Math.max(1, Math.min(50, Number.isFinite(input.limit) ? Math.floor(input.limit as number) : 20));
    const kind = input.kind === undefined ? null : kindValue(input.kind);
    const roots = this.findRoots.all({ projectId, kind, pattern: query ? searchPattern(query) : '', exact: searchable([query]), limit }) as NodeRow[];
    const graph = this.loadGraph(projectId, roots.map((row) => row.id), depth);
    const matches = roots.map((row) => this.assembleNode(row.id, graph, depth, new Set<string>()));
    return { projectId, query, kind, depth, matches, ambiguous: matches.length > 1, truncated: matches.length === limit };
  }

  public update(input: KnowledgeUpdateInput): KnowledgeUpdateResult {
    const projectId = this.resolveProject(input.projectId);
    if (!Array.isArray(input.operations)) throw new TypeError('operations must be an array');
    const operations = input.operations.map((operation) => this.validateOperation(operation));
    const counts = this.database.transaction(() => {
      const applied = this.applyOperations(projectId, operations);
      this.removeInstitutionalEntities(projectId);
      return applied;
    })();
    return { projectId, applied: operations.length, ...counts };
  }

  public mergeScan(projectIdInput: string, operations: KnowledgeUpdateOperation[]): KnowledgeUpdateResult {
    const projectId = this.resolveProject(projectIdInput);
    const validated = operations.map((operation) => this.validateOperation(operation));
    return this.database.transaction(() => {
      const counts = { nodes: 0, links: 0, mappings: 0 };
      for (const operation of validated) this.mergeOperation(projectId, operation, counts);
      this.removeInstitutionalEntities(projectId);
      return { projectId, applied: validated.length, ...counts };
    })();
  }

  public snapshot(projectIdInput: string): KnowledgeSnapshot {
    const projectId = this.resolveProject(projectIdInput);
    const storedNodes = (this.database.prepare('SELECT * FROM piecemaker_nodes WHERE project_id=? ORDER BY kind,label,id').all(projectId) as NodeRow[]).map(toNode);
    const exclusionsNode = storedNodes.find((node) => node.data.systemRole === 'gliner-exclusions');
    const exclusions = arrayValue(exclusionsNode?.data.values, 'exclusions');
    const nodes = storedNodes
      .filter((node) => node.data.systemRole !== 'gliner-exclusions')
      .filter((node) => node.kind === 'document' || !isInstitutionalEntity(node.label))
      .map(withoutInstitutionalAliases);
    const retained = new Set(nodes.map((node) => node.id));
    const links = (this.database.prepare('SELECT from_node_id,to_node_id,relation,data_json FROM piecemaker_links WHERE project_id=? ORDER BY relation,from_node_id,to_node_id').all(projectId) as LinkRow[]).map((row): KnowledgeLink => ({
      projectId,
      fromNodeId: row.from_node_id,
      toNodeId: row.to_node_id,
      relation: row.relation,
      data: parseJson<JsonData>(row.data_json, {}),
    })).filter((link) => retained.has(link.fromNodeId) && retained.has(link.toNodeId));
    const mappings = (this.database.prepare('SELECT project_id,node_id,real_value,masked_value,data_json FROM piecemaker_mappings WHERE project_id=? ORDER BY real_value').all(projectId) as MappingRow[])
      .map(toMapping)
      .filter((mapping) => retained.has(mapping.nodeId) && !isInstitutionalEntity(mapping.real));
    const citations = (this.database.prepare('SELECT id,from_node_id,to_node_id,relation,texte,piece_id,source,created_at FROM piecemaker_citations WHERE project_id=? ORDER BY id').all(projectId) as CitationRow[])
      .map((row) => toCitation(projectId, row))
      .filter((citation) => retained.has(citation.fromNodeId) && retained.has(citation.toNodeId));
    const anonymizationComplete = Boolean(this.database.prepare('SELECT 1 FROM piecemaker_anonymization_status WHERE project_id=?').get(projectId));
    return { projectId, nodes, links, mappings, citations, exclusions, exclusionsInitialized: Boolean(exclusionsNode), anonymizationComplete, reservedCodes: this.reservedCodes(projectId) };
  }

  public mappingCounts(): Map<string, number> {
    const rows = this.database.prepare('SELECT project_id, COUNT(*) AS count FROM piecemaker_mappings GROUP BY project_id').all() as Array<{ project_id: string; count: number }>;
    return new Map(rows.map((row) => [row.project_id, row.count]));
  }

  public reservedCodes(projectIdInput: string): string[] {
    const projectId = this.resolveProject(projectIdInput);
    return (this.database.prepare(`SELECT masked_value AS code FROM piecemaker_mappings WHERE project_id<>?
      UNION SELECT substr(id, 8) AS code FROM piecemaker_nodes WHERE project_id<>? AND id LIKE 'entity:%'
      ORDER BY code`).all(projectId, projectId) as Array<{ code: string }>).map(({ code }) => code);
  }

  public markAnonymizationComplete(projectIdInput: string): void {
    const projectId = this.resolveProject(projectIdInput);
    this.database.prepare(`
      INSERT INTO piecemaker_anonymization_status(project_id, completed_at)
      VALUES (?, ?)
      ON CONFLICT(project_id) DO UPDATE SET completed_at=excluded.completed_at
    `).run(projectId, at());
  }

  public close(): void { if (this.ownsDatabase) this.database.close(); }
  public tableNames(): string[] { return (this.database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'piecemaker_%' ORDER BY name").all() as Array<{ name: string }>).map(({ name }) => name); }

  private removeInstitutionalEntities(projectId: string): number {
    const rows = this.database.prepare("SELECT id,kind,label,aliases_json FROM piecemaker_nodes WHERE project_id=? AND id NOT LIKE 'system:%'").all(projectId) as Array<{ id: string; kind: string; label: string; aliases_json: string }>;
    const dropNode = this.database.prepare('DELETE FROM piecemaker_nodes WHERE project_id=? AND id=?');
    const dropNodeMappings = this.database.prepare('DELETE FROM piecemaker_mappings WHERE project_id=? AND node_id=?');
    const dropNodeLinks = this.database.prepare('DELETE FROM piecemaker_links WHERE project_id=? AND (from_node_id=? OR to_node_id=?)');
    const dropMapping = this.database.prepare('DELETE FROM piecemaker_mappings WHERE project_id=? AND node_id=? AND real_value=?');
    const rewriteAliases = this.database.prepare('UPDATE piecemaker_nodes SET aliases_json=?,search_text=?,updated_at=? WHERE project_id=? AND id=?');
    const readMappings = this.database.prepare('SELECT real_value FROM piecemaker_mappings WHERE project_id=? AND node_id=?');
    const timestamp = new Date().toISOString();
    let removed = 0;
    for (const row of rows) {
      if (row.kind !== 'document' && isInstitutionalEntity(row.label)) {
        dropNodeMappings.run(projectId, row.id);
        dropNodeLinks.run(projectId, row.id, row.id);
        dropNode.run(projectId, row.id);
        removed += 1;
        continue;
      }
      const aliases = parseJson<string[]>(row.aliases_json, []);
      const kept = aliases.filter((alias) => !isInstitutionalEntity(alias));
      if (kept.length !== aliases.length) rewriteAliases.run(JSON.stringify(kept), searchable([row.label, ...kept]), timestamp, projectId, row.id);
      for (const mapping of readMappings.all(projectId, row.id) as Array<{ real_value: string }>) {
        if (isInstitutionalEntity(mapping.real_value)) dropMapping.run(projectId, row.id, mapping.real_value);
      }
    }
    return removed;
  }

  private resolveProject(value: string | undefined): string {
    const candidate = requiredText(value, 'projectId or projectPath');
    const row = this.findProject.get({ value: candidate }) as { project_id: string } | undefined;
    if (!row) throw new Error(`project not found: ${candidate}`);
    return row.project_id;
  }

  private validateOperation(operation: KnowledgeUpdateOperation): KnowledgeUpdateOperation {
    if (!operation || typeof operation !== 'object' || !['upsertNode','link','unlink','cite','upsertMapping','deleteMapping','removePartyDesignation','deleteNode','renameNode'].includes(operation.op)) throw new TypeError('unsupported operation');
    return operation;
  }

  private applyOperations(projectId: string, operations: KnowledgeUpdateOperation[]): Counts {
    const counts = { nodes: 0, links: 0, mappings: 0 };
    for (const operation of operations) this.applyOperation(projectId, operation, counts);
    return counts;
  }

  private applyOperation(projectId: string, operation: KnowledgeUpdateOperation, counts: Counts): void {
    const timestamp = at();
    if (operation.op === 'upsertNode') {
      const node = operation.node as KnowledgeNodeInput;
      const id = requiredText(node.id, 'node.id');
      const kind = kindValue(node.kind);
      const label = optionalText(node.label);
      const aliases = arrayValue(node.aliases, 'node.aliases');
      this.upsertNode.run({ projectId, id, kind, label, searchText: searchable([label, ...aliases]), aliases: JSON.stringify(aliases), data: JSON.stringify(objectValue(node.data, 'node.data')), date: dateValue(node.date), dateGiven: node.date === undefined ? 0 : 1, at: timestamp });
      counts.nodes += 1;
      return;
    }
    if (operation.op === 'link' || operation.op === 'unlink') {
      const link = operation.link as KnowledgeLinkInput;
      const values = { projectId, fromNodeId: requiredText(link.fromNodeId, 'link.fromNodeId'), toNodeId: requiredText(link.toNodeId, 'link.toNodeId'), relation: requiredText(link.relation, 'link.relation') };
      if (operation.op === 'unlink') this.deleteLink.run(values);
      else this.upsertLink.run({ ...values, data: JSON.stringify(objectValue(link.data, 'link.data')), at: timestamp });
      counts.links += 1;
      return;
    }
    if (operation.op === 'cite') {
      this.addCitation.run(this.citationValues(projectId, operation.citation));
      return;
    }
    if (operation.op === 'deleteMapping') {
      const values = { projectId, nodeId: requiredText(operation.mapping.nodeId, 'mapping.nodeId'), real: requiredText(operation.mapping.real, 'mapping.real') };
      this.deleteMapping.run(values);
      counts.mappings += 1;
      return;
    }
    if (operation.op === 'upsertMapping') {
      const mapping = operation.mapping;
      const values = { projectId, nodeId: requiredText(mapping.nodeId, 'mapping.nodeId'), real: requiredText(mapping.real, 'mapping.real') };
      this.assertCodeFree(projectId, requiredText(mapping.masked, 'mapping.masked'));
      this.upsertMapping.run({ ...values, masked: requiredText(mapping.masked, 'mapping.masked'), searchText: searchable([mapping.real, mapping.masked]), data: JSON.stringify(objectValue(mapping.data, 'mapping.data')), at: timestamp });
      counts.mappings += 1;
      return;
    }
    if (operation.op === 'removePartyDesignation') {
      this.removePartyDesignation.run({ projectId, nodeId: requiredText(operation.nodeId, 'nodeId'), at: timestamp });
      counts.nodes += 1;
      return;
    }
    if (operation.op === 'renameNode') {
      const fromNodeId = requiredText(operation.rename.fromNodeId, 'rename.fromNodeId');
      const toNodeId = requiredText(operation.rename.toNodeId, 'rename.toNodeId');
      if (toNodeId.startsWith('entity:')) this.assertCodeFree(projectId, toNodeId.slice('entity:'.length));
      if (fromNodeId !== toNodeId) this.renameNodeRows(projectId, fromNodeId, toNodeId, timestamp);
      counts.nodes += 1;
      return;
    }
    this.deleteNode.run({ projectId, nodeId: requiredText(operation.nodeId, 'nodeId') });
    counts.nodes += 1;
  }

  private citationValues(projectId: string, citation: KnowledgeCitationInput) {
    const pieceId = optionalText(citation.pieceId) || null;
    const source = optionalText(citation.source) || null;
    if (!pieceId && !source) throw new TypeError('citation needs pieceId or source');
    return { projectId, fromNodeId: requiredText(citation.fromNodeId, 'citation.fromNodeId'), toNodeId: requiredText(citation.toNodeId, 'citation.toNodeId'), relation: requiredText(citation.relation, 'citation.relation'), texte: requiredText(citation.texte, 'citation.texte'), pieceId, source };
  }

  private mergeOperation(projectId: string, operation: KnowledgeUpdateOperation, counts: Counts): void {
    const timestamp = at();
    if (operation.op === 'upsertNode') {
      const node = operation.node as KnowledgeNodeInput;
      const row = this.database.prepare('SELECT * FROM piecemaker_nodes WHERE project_id=? AND id=?').get(projectId, requiredText(node.id, 'node.id')) as NodeRow | undefined;
      if (!row) return this.applyOperation(projectId, operation, counts);
      const current = toNode(row);
      const incomingData = objectValue(node.data, 'node.data');
      const mergedData: JsonData = { ...incomingData, ...current.data };
      if (current.id === EXCLUSIONS_NODE_ID) mergedData.values = [...new Set([...arrayValue(current.data.values, 'exclusions'), ...arrayValue(incomingData.values, 'exclusions')])];
      const aliases = [...new Set([...current.aliases, ...arrayValue(node.aliases, 'node.aliases')])].filter((alias) => alias !== current.label);
      const date = current.date ?? dateValue(node.date);
      const changed = JSON.stringify(aliases) !== row.aliases_json || JSON.stringify(mergedData) !== row.data_json || date !== current.date;
      if (changed) this.database.prepare('UPDATE piecemaker_nodes SET aliases_json=?,search_text=?,data_json=?,doc_date=?,updated_at=? WHERE project_id=? AND id=?').run(JSON.stringify(aliases), searchable([current.label, ...aliases]), JSON.stringify(mergedData), date, timestamp, projectId, current.id);
      counts.nodes += 1;
      return;
    }
    if (operation.op === 'link') {
      const link = operation.link as KnowledgeLinkInput;
      this.addLinkIfAbsent.run({ projectId, fromNodeId: requiredText(link.fromNodeId, 'link.fromNodeId'), toNodeId: requiredText(link.toNodeId, 'link.toNodeId'), relation: requiredText(link.relation, 'link.relation'), data: JSON.stringify(objectValue(link.data, 'link.data')), at: timestamp });
      counts.links += 1;
      return;
    }
    if (operation.op === 'upsertMapping') {
      const mapping = operation.mapping;
      const masked = requiredText(mapping.masked, 'mapping.masked');
      this.assertCodeFree(projectId, masked);
      this.addMappingIfAbsent.run({ projectId, nodeId: requiredText(mapping.nodeId, 'mapping.nodeId'), real: requiredText(mapping.real, 'mapping.real'), masked, searchText: searchable([mapping.real, masked]), data: JSON.stringify(objectValue(mapping.data, 'mapping.data')), at: timestamp });
      counts.mappings += 1;
      return;
    }
    if (operation.op === 'cite') return this.applyOperation(projectId, operation, counts);
    throw new TypeError('mergeScan only accepts upsertNode, link, upsertMapping and cite');
  }

  private assertCodeFree(projectId: string, code: string): void {
    const owner = this.findCodeOwner.get({ projectId, code }) as { project_id: string } | undefined;
    if (owner) throw new Error(`code ${code} already used by another case`);
  }

  private renumberConflictingCodes(): number {
    const holders = this.database.prepare(`SELECT code, project_id, MIN(created_at) AS first_seen FROM (
        SELECT masked_value AS code, project_id, created_at FROM piecemaker_mappings
        UNION ALL SELECT substr(id, 8), project_id, created_at FROM piecemaker_nodes WHERE id LIKE 'entity:%'
      ) GROUP BY code, project_id ORDER BY code, first_seen, project_id`).all() as Array<{ code: string; project_id: string }>;
    const used = new Set(holders.map(({ code }) => code));
    const owners = new Map<string, string>();
    const timestamp = at();
    let renumbered = 0;
    for (const { code, project_id: projectId } of holders) {
      if (!owners.has(code)) {
        owners.set(code, projectId);
        continue;
      }
      const replacement = nextFreeCode(code, used);
      used.add(replacement);
      if (this.database.prepare('SELECT 1 FROM piecemaker_nodes WHERE project_id=? AND id=?').get(projectId, `entity:${code}`)) {
        this.renameNodeRows(projectId, `entity:${code}`, `entity:${replacement}`, timestamp);
      }
      this.database.prepare('UPDATE piecemaker_mappings SET masked_value=?, search_text=replace(search_text, ?, ?), updated_at=? WHERE project_id=? AND masked_value=?')
        .run(replacement, searchable([code]), searchable([replacement]), timestamp, projectId, code);
      this.database.prepare("UPDATE piecemaker_nodes SET data_json=json_set(data_json, '$.code', ?), updated_at=? WHERE project_id=? AND json_extract(data_json, '$.code')=?")
        .run(replacement, timestamp, projectId, code);
      renumbered += 1;
    }
    return renumbered;
  }

  private renameNodeRows(projectId: string, fromNodeId: string, toNodeId: string, timestamp: string): void {
    const source = this.database.prepare('SELECT * FROM piecemaker_nodes WHERE project_id=? AND id=?').get(projectId, fromNodeId) as NodeRow | undefined;
    if (!source) return;
    const masked = toNodeId.startsWith('entity:') ? toNodeId.slice('entity:'.length) : '';
    const data = parseJson<JsonData>(source.data_json, {});
    if (masked) data.code = masked;
    this.database.prepare('INSERT INTO piecemaker_nodes(project_id,id,kind,label,search_text,aliases_json,data_json,doc_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,id) DO UPDATE SET kind=excluded.kind,label=excluded.label,search_text=excluded.search_text,aliases_json=excluded.aliases_json,data_json=excluded.data_json,doc_date=excluded.doc_date,updated_at=excluded.updated_at')
      .run(projectId, toNodeId, source.kind, source.label, searchable([source.label, ...parseJson<string[]>(source.aliases_json, [])]), source.aliases_json, JSON.stringify(data), source.doc_date, source.created_at, timestamp);
    const mappings = this.database.prepare('SELECT * FROM piecemaker_mappings WHERE project_id=? AND node_id=?').all(projectId, fromNodeId) as MappingRow[];
    this.database.prepare('DELETE FROM piecemaker_mappings WHERE project_id=? AND node_id=?').run(projectId, fromNodeId);
    for (const row of mappings) {
      const maskedValue = masked || row.masked_value;
      this.upsertMapping.run({ projectId, nodeId: toNodeId, real: row.real_value, masked: maskedValue, searchText: searchable([row.real_value, maskedValue]), data: row.data_json, at: timestamp });
    }
    const links = this.database.prepare('SELECT from_node_id,to_node_id,relation,data_json,created_at FROM piecemaker_links WHERE project_id=? AND (from_node_id=? OR to_node_id=?)').all(projectId, fromNodeId, fromNodeId) as Array<LinkRow & { created_at: string }>;
    for (const link of links) {
      const newFrom = link.from_node_id === fromNodeId ? toNodeId : link.from_node_id;
      const newTo = link.to_node_id === fromNodeId ? toNodeId : link.to_node_id;
      this.database.prepare('INSERT INTO piecemaker_links(project_id,from_node_id,to_node_id,relation,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id,from_node_id,to_node_id,relation) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at')
        .run(projectId, newFrom, newTo, link.relation, link.data_json, link.created_at, timestamp);
      this.database.prepare('UPDATE piecemaker_citations SET from_node_id=?,to_node_id=? WHERE project_id=? AND from_node_id=? AND to_node_id=? AND relation=?')
        .run(newFrom, newTo, projectId, link.from_node_id, link.to_node_id, link.relation);
      this.database.prepare('DELETE FROM piecemaker_links WHERE project_id=? AND from_node_id=? AND to_node_id=? AND relation=?').run(projectId, link.from_node_id, link.to_node_id, link.relation);
    }
    this.database.prepare('UPDATE piecemaker_citations SET piece_id=? WHERE project_id=? AND piece_id=?').run(toNodeId, projectId, fromNodeId);
    this.deleteNode.run({ projectId, nodeId: fromNodeId });
  }

  private loadGraph(projectId: string, rootIds: string[], depth: number): LoadedGraph {
    if (!rootIds.length) return { nodes: new Map(), links: [], mappings: new Map() };
    const roots = rootIds.map(() => '?').join(',');
    const nodeRows = this.database.prepare(`WITH RECURSIVE reachable(id,depth) AS (SELECT id,0 FROM piecemaker_nodes WHERE project_id=? AND id IN (${roots}) UNION SELECT CASE WHEN l.from_node_id=r.id THEN l.to_node_id ELSE l.from_node_id END,r.depth+1 FROM reachable r JOIN piecemaker_links l ON l.project_id=? AND (l.from_node_id=r.id OR l.to_node_id=r.id) WHERE r.depth<?) SELECT DISTINCT n.* FROM piecemaker_nodes n JOIN reachable r ON r.id=n.id WHERE n.project_id=?`).all(projectId, ...rootIds, projectId, depth, projectId) as NodeRow[];
    const ids = nodeRows.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(',');
    const links = this.database.prepare(`SELECT from_node_id,to_node_id,relation,data_json FROM piecemaker_links WHERE project_id=? AND from_node_id IN (${placeholders}) AND to_node_id IN (${placeholders}) ORDER BY relation,from_node_id,to_node_id`).all(projectId, ...ids, ...ids) as LinkRow[];
    const mappingRows = this.database.prepare(`SELECT project_id,node_id,real_value,masked_value,data_json FROM piecemaker_mappings WHERE project_id=? AND node_id IN (${placeholders}) ORDER BY real_value`).all(projectId, ...ids) as MappingRow[];
    const mappings = new Map<string, KnowledgeMapping[]>();
    for (const row of mappingRows) mappings.set(row.node_id, [...(mappings.get(row.node_id) || []), toMapping(row)]);
    return { nodes: new Map(nodeRows.map((row) => [row.id, row])), links, mappings };
  }

  private assembleNode(nodeId: string, graph: LoadedGraph, depth: number, visited: Set<string>): KnowledgeResolvedNode {
    const row = graph.nodes.get(nodeId);
    if (!row) throw new Error(`node not found: ${nodeId}`);
    const nextVisited = new Set(visited).add(nodeId);
    const links: KnowledgeResolvedLink[] = [];
    for (const link of graph.links) {
      if (link.from_node_id !== nodeId && link.to_node_id !== nodeId) continue;
      const outgoing = link.from_node_id === nodeId;
      const relatedId = outgoing ? link.to_node_id : link.from_node_id;
      const cycle = nextVisited.has(relatedId);
      links.push({ relation: link.relation, direction: outgoing ? 'outgoing' : 'incoming', data: parseJson<JsonData>(link.data_json, {}), node: depth > 0 && !cycle ? this.assembleNode(relatedId, graph, depth - 1, nextVisited) : null, cycle });
    }
    return { ...toNode(row), mappings: graph.mappings.get(nodeId) || [], links };
  }
}

let singleton: KnowledgeStore | null = null;
export function getKnowledgeStore(): KnowledgeStore { if (!singleton) singleton = new KnowledgeStore(); return singleton; }
export function closeKnowledgeStore(): void { singleton?.close(); singleton = null; }
export function knowledgeQuery(input: KnowledgeQueryInput): KnowledgeQueryResult { return getKnowledgeStore().query(input); }
export function knowledgeUpdate(input: KnowledgeUpdateInput): KnowledgeUpdateResult { return getKnowledgeStore().update(input); }
