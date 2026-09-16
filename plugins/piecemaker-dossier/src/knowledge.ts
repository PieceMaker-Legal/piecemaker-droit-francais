import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { isInstitutionalEntity } from './institutional-terms.js';

import { NODE_KINDS } from './types.js';
import type {
  JsonData,
  KnowledgeLinkInput,
  KnowledgeLink,
  KnowledgeMapping,
  KnowledgeNode,
  KnowledgeNodeInput,
  KnowledgeOrigin,
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
type NodeRow = { id: string; project_id: string; kind: NodeKind; label: string; aliases_json: string; data_json: string; origin: KnowledgeOrigin; created_at: string; updated_at: string };
type LinkRow = { from_node_id: string; to_node_id: string; relation: string; data_json: string; origin: KnowledgeOrigin };
type MappingRow = { project_id: string; node_id: string; real_value: string; masked_value: string; data_json: string; origin: KnowledgeOrigin };
type Counts = { nodes: number; links: number; mappings: number };
type LoadedGraph = { nodes: Map<string, NodeRow>; links: LinkRow[]; mappings: Map<string, KnowledgeMapping[]> };

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS piecemaker_nodes (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('person','company','document','iban','address','phone','email','url','siren','other')),
  label TEXT NOT NULL DEFAULT '',
  search_text TEXT NOT NULL DEFAULT '',
  aliases_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases_json)),
  data_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data_json)),
  origin TEXT NOT NULL CHECK (origin IN ('gliner','manual','llm')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS piecemaker_links (
  project_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data_json)),
  origin TEXT NOT NULL CHECK (origin IN ('gliner','manual','llm')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, from_node_id, to_node_id, relation),
  FOREIGN KEY (project_id, from_node_id) REFERENCES piecemaker_nodes(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, to_node_id) REFERENCES piecemaker_nodes(project_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS piecemaker_mappings (
  project_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  real_value TEXT NOT NULL,
  masked_value TEXT NOT NULL,
  search_text TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data_json)),
  origin TEXT NOT NULL CHECK (origin IN ('gliner','manual','llm')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, node_id, real_value),
  FOREIGN KEY (project_id, node_id) REFERENCES piecemaker_nodes(project_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS piecemaker_anonymization_status (
  project_id TEXT PRIMARY KEY NOT NULL,
  completed_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS piecemaker_nodes_lookup ON piecemaker_nodes(project_id, kind, search_text);
CREATE INDEX IF NOT EXISTS piecemaker_links_from ON piecemaker_links(project_id, from_node_id);
CREATE INDEX IF NOT EXISTS piecemaker_links_to ON piecemaker_links(project_id, to_node_id);
CREATE INDEX IF NOT EXISTS piecemaker_mappings_lookup ON piecemaker_mappings(project_id, search_text);
CREATE INDEX IF NOT EXISTS piecemaker_mappings_masked ON piecemaker_mappings(project_id, masked_value);
`;

const at = (): string => new Date().toISOString();
const parseJson = <T>(value: string, fallback: T): T => { try { return JSON.parse(value) as T; } catch { return fallback; } };
const requiredText = (value: unknown, field: string): string => { if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string`); return value.trim(); };
const optionalText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const objectValue = (value: unknown, field: string): JsonData => { if (value === undefined) return {}; if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${field} must be an object`); return value as JsonData; };
const arrayValue = (value: unknown, field: string): string[] => { if (value === undefined) return []; if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw new TypeError(`${field} must be an array of strings`); return [...new Set(value.map((entry) => entry.trim()).filter(Boolean))]; };
const originValue = (value: unknown): KnowledgeOrigin => value === 'gliner' || value === 'manual' || value === 'llm' ? value : 'manual';
const kindValue = (value: unknown): NodeKind => { if (typeof value !== 'string' || !NODE_KINDS.includes(value as NodeKind)) throw new TypeError(`kind must be one of ${NODE_KINDS.join(', ')}`); return value as NodeKind; };
const searchable = (values: string[]): string => values.join('\u0000').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
const searchPattern = (value: string): string => `%${searchable([value]).replace(/[\\%_]/g, '\\$&')}%`;
const toNode = (row: NodeRow): KnowledgeNode => ({ id: row.id, projectId: row.project_id, kind: row.kind, label: row.label, aliases: parseJson<string[]>(row.aliases_json, []), data: parseJson<JsonData>(row.data_json, {}), createdAt: row.created_at, updatedAt: row.updated_at });
const withoutInstitutionalAliases = (node: KnowledgeNode): KnowledgeNode => ({ ...node, aliases: node.aliases.filter((alias) => !isInstitutionalEntity(alias)) });
const toMapping = (row: MappingRow): KnowledgeMapping => ({ projectId: row.project_id, nodeId: row.node_id, real: row.real_value, masked: row.masked_value, data: parseJson<JsonData>(row.data_json, {}) });

export function resolveKnowledgeDatabasePath(): string {
  return process.env.DATABASE_PATH || path.join(process.env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker'), 'auth.db');
}

export function initializeKnowledgeSchema(database: DatabaseConnection): void {
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  database.exec(SCHEMA_SQL);
}

export class KnowledgeStore {
  private readonly database: DatabaseConnection;
  private readonly ownsDatabase: boolean;
  private readonly findRoots;
  private readonly findProject;
  private readonly upsertNode;
  private readonly upsertLink;
  private readonly deleteLink;
  private readonly upsertMapping;
  private readonly deleteMapping;
  private readonly removePartyDesignation;
  private readonly deleteNode;

  public constructor(databaseSource: string | DatabaseConnection = resolveKnowledgeDatabasePath()) {
    this.ownsDatabase = typeof databaseSource === 'string';
    if (typeof databaseSource === 'string') fs.mkdirSync(path.dirname(databaseSource), { recursive: true, mode: 0o700 });
    this.database = typeof databaseSource === 'string' ? new Database(databaseSource) : databaseSource;
    initializeKnowledgeSchema(this.database);
    this.findRoots = this.database.prepare(`SELECT DISTINCT n.* FROM piecemaker_nodes n LEFT JOIN piecemaker_mappings m ON m.project_id=n.project_id AND m.node_id=n.id WHERE n.project_id=@projectId AND n.id NOT LIKE 'system:%' AND (@kind IS NULL OR n.kind=@kind) AND (@pattern='' OR n.search_text LIKE @pattern ESCAPE '\\' OR m.search_text LIKE @pattern ESCAPE '\\') ORDER BY CASE WHEN n.search_text=@exact THEN 0 ELSE 1 END,n.label,n.id LIMIT @limit`);
    this.findProject = this.database.prepare('SELECT project_id FROM projects WHERE project_id=@value OR project_path=@value LIMIT 1');
    this.upsertNode = this.database.prepare(`INSERT INTO piecemaker_nodes(project_id,id,kind,label,search_text,aliases_json,data_json,origin,created_at,updated_at) VALUES(@projectId,@id,@kind,@label,@searchText,@aliases,@data,@origin,@at,@at) ON CONFLICT(project_id,id) DO UPDATE SET kind=excluded.kind,label=excluded.label,search_text=excluded.search_text,aliases_json=excluded.aliases_json,data_json=excluded.data_json,origin=excluded.origin,updated_at=excluded.updated_at`);
    this.upsertLink = this.database.prepare(`INSERT INTO piecemaker_links(project_id,from_node_id,to_node_id,relation,data_json,origin,created_at,updated_at) VALUES(@projectId,@fromNodeId,@toNodeId,@relation,@data,@origin,@at,@at) ON CONFLICT(project_id,from_node_id,to_node_id,relation) DO UPDATE SET data_json=excluded.data_json,origin=excluded.origin,updated_at=excluded.updated_at`);
    this.deleteLink = this.database.prepare('DELETE FROM piecemaker_links WHERE project_id=@projectId AND from_node_id=@fromNodeId AND to_node_id=@toNodeId AND relation=@relation');
    this.upsertMapping = this.database.prepare(`INSERT INTO piecemaker_mappings(project_id,node_id,real_value,masked_value,search_text,data_json,origin,created_at,updated_at) VALUES(@projectId,@nodeId,@real,@masked,@searchText,@data,@origin,@at,@at) ON CONFLICT(project_id,node_id,real_value) DO UPDATE SET masked_value=excluded.masked_value,search_text=excluded.search_text,data_json=excluded.data_json,origin=excluded.origin,updated_at=excluded.updated_at`);
    this.deleteMapping = this.database.prepare('DELETE FROM piecemaker_mappings WHERE project_id=@projectId AND node_id=@nodeId AND real_value=@real');
    this.removePartyDesignation = this.database.prepare("UPDATE piecemaker_nodes SET data_json=json_remove(data_json, '$.partySide', '$.position'), updated_at=@at WHERE project_id=@projectId AND id=@nodeId");
    this.deleteNode = this.database.prepare('DELETE FROM piecemaker_nodes WHERE project_id=@projectId AND id=@nodeId');
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

  public replaceOrigin(projectIdInput: string, origin: KnowledgeOrigin, operations: KnowledgeUpdateOperation[]): KnowledgeUpdateResult {
    const projectId = this.resolveProject(projectIdInput);
    const validated = operations.map((operation) => this.validateOperation(operation));
    return this.database.transaction(() => {
      this.database.prepare('DELETE FROM piecemaker_links WHERE project_id=? AND origin=?').run(projectId, origin);
      this.database.prepare('DELETE FROM piecemaker_mappings WHERE project_id=? AND origin=?').run(projectId, origin);
      this.database.prepare(`DELETE FROM piecemaker_nodes
        WHERE project_id=? AND origin=?
        AND NOT EXISTS (
          SELECT 1 FROM piecemaker_links
          WHERE project_id=piecemaker_nodes.project_id
          AND (from_node_id=piecemaker_nodes.id OR to_node_id=piecemaker_nodes.id)
          AND origin<>?
        )
        AND NOT EXISTS (
          SELECT 1 FROM piecemaker_mappings
          WHERE project_id=piecemaker_nodes.project_id
          AND node_id=piecemaker_nodes.id
          AND origin<>?
        )`).run(projectId, origin, origin, origin);
      const counts = this.applyOperations(projectId, validated);
      this.removeInstitutionalEntities(projectId);
      return { projectId, applied: validated.length, ...counts };
    })();
  }

  public purgeInstitutionalEntities(projectIdInput: string): number {
    const projectId = this.resolveProject(projectIdInput);
    return this.database.transaction(() => this.removeInstitutionalEntities(projectId))();
  }

  public snapshot(projectIdInput: string): KnowledgeSnapshot {
    const projectId = this.resolveProject(projectIdInput);
    const storedNodes = (this.database.prepare('SELECT * FROM piecemaker_nodes WHERE project_id=? ORDER BY kind,label,id').all(projectId) as NodeRow[]).map(toNode);
    const exclusionsNode = storedNodes.find((node) => node.data.systemRole === 'gliner-exclusions');
    const exclusions = arrayValue(exclusionsNode?.data.values, 'exclusions');
    const nodes = storedNodes
      .filter((node) => node.data.systemRole !== 'gliner-exclusions')
      .filter((node) => !isInstitutionalEntity(node.label))
      .map(withoutInstitutionalAliases);
    const retained = new Set(nodes.map((node) => node.id));
    const links = (this.database.prepare('SELECT from_node_id,to_node_id,relation,data_json,origin FROM piecemaker_links WHERE project_id=? ORDER BY relation,from_node_id,to_node_id').all(projectId) as LinkRow[]).map((row): KnowledgeLink => ({
      projectId,
      fromNodeId: row.from_node_id,
      toNodeId: row.to_node_id,
      relation: row.relation,
      data: parseJson<JsonData>(row.data_json, {}),
    })).filter((link) => retained.has(link.fromNodeId) && retained.has(link.toNodeId));
    const mappings = (this.database.prepare('SELECT project_id,node_id,real_value,masked_value,data_json,origin FROM piecemaker_mappings WHERE project_id=? ORDER BY real_value').all(projectId) as MappingRow[])
      .map(toMapping)
      .filter((mapping) => retained.has(mapping.nodeId) && !isInstitutionalEntity(mapping.real));
    return { projectId, nodes, links, mappings, exclusions, exclusionsInitialized: Boolean(exclusionsNode) };
  }

  public glinerMappingKeys(projectIdInput: string): Array<{ nodeId: string; real: string }> {
    const projectId = this.resolveProject(projectIdInput);
    return this.database.prepare("SELECT node_id AS nodeId, real_value AS real FROM piecemaker_mappings WHERE project_id=? AND origin='gliner'").all(projectId) as Array<{ nodeId: string; real: string }>;
  }

  public markAnonymizationComplete(projectIdInput: string): void {
    const projectId = this.resolveProject(projectIdInput);
    this.database.prepare(`
      INSERT INTO piecemaker_anonymization_status(project_id, completed_at)
      VALUES (?, ?)
      ON CONFLICT(project_id) DO UPDATE SET completed_at=excluded.completed_at
    `).run(projectId, at());
  }

  public listAnonymizationStatuses(): Array<{ projectId: string; projectPath: string; completedAt: string }> {
    return this.database.prepare(`
      SELECT s.project_id AS projectId, p.project_path AS projectPath, s.completed_at AS completedAt
      FROM piecemaker_anonymization_status s
      INNER JOIN projects p ON p.project_id = s.project_id
      ORDER BY s.project_id
    `).all() as Array<{ projectId: string; projectPath: string; completedAt: string }>;
  }

  public close(): void { if (this.ownsDatabase) this.database.close(); }
  public tableNames(): string[] { return (this.database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'piecemaker_%' ORDER BY name").all() as Array<{ name: string }>).map(({ name }) => name); }

  private removeInstitutionalEntities(projectId: string): number {
    const rows = this.database.prepare("SELECT id,label,aliases_json FROM piecemaker_nodes WHERE project_id=? AND id NOT LIKE 'system:%'").all(projectId) as Array<{ id: string; label: string; aliases_json: string }>;
    const dropNode = this.database.prepare('DELETE FROM piecemaker_nodes WHERE project_id=? AND id=?');
    const dropNodeMappings = this.database.prepare('DELETE FROM piecemaker_mappings WHERE project_id=? AND node_id=?');
    const dropNodeLinks = this.database.prepare('DELETE FROM piecemaker_links WHERE project_id=? AND (from_node_id=? OR to_node_id=?)');
    const dropMapping = this.database.prepare('DELETE FROM piecemaker_mappings WHERE project_id=? AND node_id=? AND real_value=?');
    const rewriteAliases = this.database.prepare('UPDATE piecemaker_nodes SET aliases_json=?,search_text=?,updated_at=? WHERE project_id=? AND id=?');
    const readMappings = this.database.prepare('SELECT real_value FROM piecemaker_mappings WHERE project_id=? AND node_id=?');
    const timestamp = new Date().toISOString();
    let removed = 0;
    for (const row of rows) {
      if (isInstitutionalEntity(row.label)) {
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
    if (!operation || typeof operation !== 'object' || !['upsertNode','link','unlink','upsertMapping','deleteMapping','removePartyDesignation','deleteNode','renameNode'].includes(operation.op)) throw new TypeError('unsupported operation');
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
      this.upsertNode.run({ projectId, id, kind, label, searchText: searchable([label, ...aliases]), aliases: JSON.stringify(aliases), data: JSON.stringify(objectValue(node.data, 'node.data')), origin: originValue(node.origin), at: timestamp });
      counts.nodes += 1;
      return;
    }
    if (operation.op === 'link' || operation.op === 'unlink') {
      const link = operation.link as KnowledgeLinkInput;
      const values = { projectId, fromNodeId: requiredText(link.fromNodeId, 'link.fromNodeId'), toNodeId: requiredText(link.toNodeId, 'link.toNodeId'), relation: requiredText(link.relation, 'link.relation') };
      if (operation.op === 'unlink') this.deleteLink.run(values);
      else this.upsertLink.run({ ...values, data: JSON.stringify(objectValue(link.data, 'link.data')), origin: originValue(link.origin), at: timestamp });
      counts.links += 1;
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
      this.upsertMapping.run({ ...values, masked: requiredText(mapping.masked, 'mapping.masked'), searchText: searchable([mapping.real, mapping.masked]), data: JSON.stringify(objectValue(mapping.data, 'mapping.data')), origin: originValue(mapping.origin), at: timestamp });
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
      if (fromNodeId !== toNodeId) this.renameNodeRows(projectId, fromNodeId, toNodeId, timestamp);
      counts.nodes += 1;
      return;
    }
    this.deleteNode.run({ projectId, nodeId: requiredText(operation.nodeId, 'nodeId') });
    counts.nodes += 1;
  }

  private renameNodeRows(projectId: string, fromNodeId: string, toNodeId: string, timestamp: string): void {
    const source = this.database.prepare('SELECT * FROM piecemaker_nodes WHERE project_id=? AND id=?').get(projectId, fromNodeId) as NodeRow | undefined;
    if (!source) return;
    const masked = toNodeId.startsWith('entity:') ? toNodeId.slice('entity:'.length) : '';
    const data = parseJson<JsonData>(source.data_json, {});
    if (masked) data.code = masked;
    this.database.prepare('INSERT INTO piecemaker_nodes(project_id,id,kind,label,search_text,aliases_json,data_json,origin,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,id) DO UPDATE SET kind=excluded.kind,label=excluded.label,search_text=excluded.search_text,aliases_json=excluded.aliases_json,data_json=excluded.data_json,updated_at=excluded.updated_at')
      .run(projectId, toNodeId, source.kind, source.label, searchable([source.label, ...parseJson<string[]>(source.aliases_json, [])]), source.aliases_json, JSON.stringify(data), source.origin, source.created_at, timestamp);
    const mappings = this.database.prepare('SELECT * FROM piecemaker_mappings WHERE project_id=? AND node_id=?').all(projectId, fromNodeId) as MappingRow[];
    this.database.prepare('DELETE FROM piecemaker_mappings WHERE project_id=? AND node_id=?').run(projectId, fromNodeId);
    for (const row of mappings) {
      const maskedValue = masked || row.masked_value;
      this.upsertMapping.run({ projectId, nodeId: toNodeId, real: row.real_value, masked: maskedValue, searchText: searchable([row.real_value, maskedValue]), data: row.data_json, origin: row.origin, at: timestamp });
    }
    this.database.prepare('UPDATE OR REPLACE piecemaker_links SET from_node_id=?,updated_at=? WHERE project_id=? AND from_node_id=?').run(toNodeId, timestamp, projectId, fromNodeId);
    this.database.prepare('UPDATE OR REPLACE piecemaker_links SET to_node_id=?,updated_at=? WHERE project_id=? AND to_node_id=?').run(toNodeId, timestamp, projectId, fromNodeId);
    this.deleteNode.run({ projectId, nodeId: fromNodeId });
  }

  private loadGraph(projectId: string, rootIds: string[], depth: number): LoadedGraph {
    if (!rootIds.length) return { nodes: new Map(), links: [], mappings: new Map() };
    const roots = rootIds.map(() => '?').join(',');
    const nodeRows = this.database.prepare(`WITH RECURSIVE reachable(id,depth) AS (SELECT id,0 FROM piecemaker_nodes WHERE project_id=? AND id IN (${roots}) UNION SELECT CASE WHEN l.from_node_id=r.id THEN l.to_node_id ELSE l.from_node_id END,r.depth+1 FROM reachable r JOIN piecemaker_links l ON l.project_id=? AND (l.from_node_id=r.id OR l.to_node_id=r.id) WHERE r.depth<?) SELECT DISTINCT n.* FROM piecemaker_nodes n JOIN reachable r ON r.id=n.id WHERE n.project_id=?`).all(projectId, ...rootIds, projectId, depth, projectId) as NodeRow[];
    const ids = nodeRows.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(',');
    const links = this.database.prepare(`SELECT from_node_id,to_node_id,relation,data_json,origin FROM piecemaker_links WHERE project_id=? AND from_node_id IN (${placeholders}) AND to_node_id IN (${placeholders}) ORDER BY relation,from_node_id,to_node_id`).all(projectId, ...ids, ...ids) as LinkRow[];
    const mappingRows = this.database.prepare(`SELECT project_id,node_id,real_value,masked_value,data_json,origin FROM piecemaker_mappings WHERE project_id=? AND node_id IN (${placeholders}) ORDER BY real_value`).all(projectId, ...ids) as MappingRow[];
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
