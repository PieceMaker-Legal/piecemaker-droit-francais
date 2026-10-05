import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { findApplicationRoot, getApplicationDataRoot, getModuleDirectory } from '../../shared/utils.js';
import { KnowledgeStore, searchable } from '../../../plugins/piecemaker-dossier/src/knowledge.js';
import { partyCodeChange } from '../../../plugins/piecemaker-dossier/src/party-codes.js';
import type { PartyIdentity } from '../../../plugins/piecemaker-dossier/src/party-codes.js';
import type { KnowledgeUpdateOperation } from '../../../plugins/piecemaker-dossier/src/types.js';

type DatabaseConnection = InstanceType<typeof Database>;
type Statement = Database.Statement<unknown[]>;
type Dictionary = { mapping: Record<string, string>; reverse: Record<string, string | readonly string[]>; empty: boolean };
type DictionarySource = { getForOutbound(): Dictionary; refresh(): Dictionary; close?(): void };
type SqlValue = string | number | bigint | Buffer | null;
type ProjectRow = { project_id: string; project_path: string; custom_project_name: string | null };

export type SqlToolOptions = {
  databasePath: string;
  rename(projectId: string, piecePath: string, name: string): Promise<{ previous: string; current: string }>;
  dictionary?: DictionarySource;
  dataRoot?: string;
  now?: () => Date;
};

export type SqlToolInput = { requete: string; cwd?: string };

const require = createRequire(import.meta.url);
const applicationRoot = findApplicationRoot(getModuleDirectory(import.meta.url));
const { anonymize, deanonymize } = require(path.join(applicationRoot, 'server', 'piecemaker', 'anonymizer', 'dictionary.cjs')) as {
  anonymize(text: string, dictionary: Dictionary): string;
  deanonymize(text: string, dictionary: Pick<Dictionary, 'empty' | 'reverse'>): string;
};
const { createSqliteDictionaryLoader } = require(path.join(applicationRoot, 'server', 'piecemaker', 'anonymizer', 'sqlite-dictionary.cjs')) as {
  createSqliteDictionaryLoader(options: { databasePath: string }): DictionarySource;
};

const SECRET_TABLES = ['api_keys', 'user_credentials', 'users', 'vapid_keys', 'piecemaker_telegram_bots', 'app_config'];
const SECRET_QUERIES = [
  'SELECT api_key FROM api_keys',
  'SELECT credential_value FROM user_credentials',
  'SELECT password_hash FROM users',
  'SELECT private_key FROM vapid_keys',
  'SELECT token FROM piecemaker_telegram_bots',
  "SELECT value FROM app_config WHERE key LIKE '%secret%'",
];
const MIN_SECRET_LENGTH = 6;
const SECRET_TABLE_PATTERN = new RegExp(`(?<![\\p{L}\\p{N}_$])(?:${SECRET_TABLES.join('|')})(?![\\p{L}\\p{N}_$])`, 'u');
const CODE_LITERALS = /entity:((?:[^']|'')*)|((?:masked_value|\$\.(?:code|originalCode))\W{0,3}\s*(?:=|==|!=|<>|like)\s*)'((?:[^']|'')*)'/gi;
const TRANSACTION_CONTROL = /(?:^|;)\s*(?:begin|commit|rollback|savepoint|release|end\s+transaction)\b|^\s*end\s*;?\s*$/i;
const BACKUPS_KEPT = 4;
const BACKUP_FILE = /^auth-\d{4}-S\d{2}\.db$/;
const ID_PREFIX = /^[0-9a-f-]{4,}$/i;
const MAX_AMBIGUOUS = 5;

const TEMP_SCHEMA = `
CREATE TEMP TABLE IF NOT EXISTS entites_supprimees(project_id TEXT, label TEXT, aliases_json TEXT);
CREATE TEMP TABLE IF NOT EXISTS mentions_supprimees(project_id TEXT, piece TEXT, entite TEXT, relation TEXT);
CREATE TEMP TABLE IF NOT EXISTS renommages(project_id TEXT, id TEXT, ancien_label TEXT, ancien_chemin TEXT);
CREATE TEMP TABLE IF NOT EXISTS nouvelles_entites(project_id TEXT, id TEXT);
CREATE TEMP TRIGGER IF NOT EXISTS pm_noeuds_ajout AFTER INSERT ON main.piecemaker_nodes BEGIN
  UPDATE main.piecemaker_nodes SET search_text=recherche(NEW.label, NEW.aliases_json) WHERE project_id=NEW.project_id AND id=NEW.id;
  SELECT tic(1);
END;
CREATE TEMP TRIGGER IF NOT EXISTS pm_noeuds_maj AFTER UPDATE ON main.piecemaker_nodes BEGIN
  UPDATE main.piecemaker_nodes SET search_text=recherche(NEW.label, NEW.aliases_json), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE project_id=NEW.project_id AND id=NEW.id;
  SELECT tic(1);
END;
CREATE TEMP TRIGGER IF NOT EXISTS pm_liens_maj AFTER UPDATE ON main.piecemaker_links BEGIN
  UPDATE main.piecemaker_links SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE project_id=NEW.project_id AND from_node_id=NEW.from_node_id AND to_node_id=NEW.to_node_id AND relation=NEW.relation;
  SELECT tic(1);
END;
CREATE TEMP TRIGGER IF NOT EXISTS pm_masques_maj AFTER UPDATE ON main.piecemaker_mappings BEGIN
  UPDATE main.piecemaker_mappings SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE project_id=NEW.project_id AND node_id=NEW.node_id AND real_value=NEW.real_value;
  SELECT tic(1);
END;
CREATE TEMP TRIGGER IF NOT EXISTS pm_nouvelle_entite AFTER INSERT ON main.piecemaker_nodes WHEN suivi() AND NEW.kind IN ('person','company') AND NEW.id NOT LIKE 'system:%' BEGIN
  INSERT INTO temp.nouvelles_entites VALUES(NEW.project_id, NEW.id);
  SELECT tic(1);
END;
CREATE TEMP TRIGGER IF NOT EXISTS pm_entite_supprimee AFTER DELETE ON main.piecemaker_nodes WHEN suivi() AND OLD.kind<>'document' AND OLD.id NOT LIKE 'system:%' BEGIN
  INSERT INTO temp.entites_supprimees VALUES(OLD.project_id, OLD.label, OLD.aliases_json);
  SELECT tic(1);
END;
CREATE TEMP TRIGGER IF NOT EXISTS pm_mention_supprimee AFTER DELETE ON main.piecemaker_links WHEN suivi() AND OLD.relation='mentions' BEGIN
  INSERT INTO temp.mentions_supprimees VALUES(OLD.project_id, OLD.from_node_id, OLD.to_node_id, OLD.relation);
  SELECT tic(1);
END;
CREATE TEMP TRIGGER IF NOT EXISTS pm_piece_renommee AFTER UPDATE OF label ON main.piecemaker_nodes WHEN suivi() AND NEW.kind='document' AND NEW.label IS NOT OLD.label BEGIN
  INSERT INTO temp.renommages VALUES(NEW.project_id, NEW.id, OLD.label, json_extract(OLD.data_json, '$.path'));
  SELECT tic(1);
END;
`;
const CLEAR_TEMP_TABLES = 'DELETE FROM temp.entites_supprimees; DELETE FROM temp.mentions_supprimees; DELETE FROM temp.renommages; DELETE FROM temp.nouvelles_entites;';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const unique = (values: string[]): string[] => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
const parseAliases = (value: unknown): string[] => {
  try {
    const parsed = JSON.parse(String(value ?? '[]')) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
};
const stripComments = (sql: string): string => sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
const realPath = (value: string): string => { try { return fs.realpathSync(value); } catch { return value; } };
const contains = (root: string, directory: string): boolean => directory === root || directory.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`);
const projectName = (project: ProjectRow): string => text(project.custom_project_name) || path.basename(project.project_path) || project.project_path;

function isoWeekLabel(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const year = day.getUTCFullYear();
  const week = Math.ceil(((day.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-S${String(week).padStart(2, '0')}`;
}

function renderValue(value: SqlValue, dictionary: Dictionary): string {
  if (value === null || value === undefined) return '∅';
  if (Buffer.isBuffer(value)) return `[blob ${value.length} octets]`;
  if (typeof value !== 'string') return String(value);
  return anonymize(value, dictionary).replace(/\t/g, '\\t').replace(/\r?\n/g, '\\n');
}

function renderTable(columns: string[], rows: SqlValue[][], dictionary: Dictionary): string {
  return [columns.map((column) => renderValue(column, dictionary)).join('\t'), ...rows.map((row) => row.map((value) => renderValue(value, dictionary)).join('\t'))].join('\n');
}

export function createSqlTool(options: SqlToolOptions) {
  const now = options.now ?? (() => new Date());
  const dataRoot = options.dataRoot ?? getApplicationDataRoot();
  const ownsDictionary = !options.dictionary;
  const dictionarySource = options.dictionary ?? createSqliteDictionaryLoader({ databasePath: options.databasePath });
  const database = new Database(options.databasePath);
  database.pragma('journal_mode = WAL');
  database.pragma('busy_timeout = 5000');
  database.pragma('foreign_keys = ON');
  database.pragma('recursive_triggers = OFF');
  const store = new KnowledgeStore(database);
  const lookup = new Database(options.databasePath, { readonly: true, fileMustExist: true });
  lookup.pragma('busy_timeout = 5000');

  let tracking = false;
  let ticks = 0;
  let currentCwd: string | undefined;
  const dossierCache = new Map<string, string>();
  const escapedReverse = new WeakMap<Dictionary, Pick<Dictionary, 'empty' | 'reverse'>>();
  let queue: Promise<unknown> = Promise.resolve();

  const listProjects = (): ProjectRow[] => lookup.prepare('SELECT project_id, project_path, custom_project_name FROM projects').all() as ProjectRow[];

  const ambiguity = (matches: ProjectRow[]): Error => new Error(`ambigu : ${matches.slice(0, MAX_AMBIGUOUS).map((project) => `${project.project_id.slice(0, 6)} ${projectName(project)}`).join(' ; ')}`);

  const singleMatch = (matches: ProjectRow[]): string => {
    if (matches.length === 1) return matches[0].project_id;
    if (matches.length > 1) throw ambiguity([...matches].sort((a, b) => projectName(a).localeCompare(projectName(b))));
    throw new Error('aucun dossier');
  };

  const currentProject = (projects: ProjectRow[]): string => {
    if (!currentCwd) throw new Error('pas de dossier courant');
    const find = (directory: string, rootOf: (project: ProjectRow) => string) => projects
      .filter((project) => contains(rootOf(project), directory))
      .sort((a, b) => rootOf(b).length - rootOf(a).length)[0];
    const found = find(path.resolve(currentCwd), (project) => path.resolve(project.project_path)) ?? find(realPath(path.resolve(currentCwd)), (project) => realPath(path.resolve(project.project_path)));
    if (!found) throw new Error('pas de dossier courant');
    return found.project_id;
  };

  const projectByName = (projects: ProjectRow[], value: string): string => {
    const wanted = searchable([value]);
    const rows = lookup.prepare('SELECT project_id, node_id, real_value, masked_value FROM piecemaker_mappings').all() as Array<{ project_id: string; node_id: string; real_value: string; masked_value: string }>;
    const nodes = new Set(rows.filter((row) => searchable([row.real_value]) === wanted || searchable([row.masked_value]) === wanted).map((row) => `${row.project_id}\u0000${row.node_id}`));
    const candidates = new Set([wanted, ...rows.filter((row) => nodes.has(`${row.project_id}\u0000${row.node_id}`)).map((row) => searchable([row.real_value]))].filter(Boolean));
    const names = (project: ProjectRow): string[] => [text(project.custom_project_name), path.basename(project.project_path)].filter(Boolean).map((name) => searchable([name]));
    const exact = projects.filter((project) => names(project).some((name) => candidates.has(name)));
    if (exact.length) return singleMatch(exact);
    return singleMatch(projects.filter((project) => names(project).some((name) => [...candidates].some((candidate) => name.includes(candidate)))));
  };

  const resolveDossier = (argument: unknown): string => {
    const value = argument === undefined || argument === null ? null : String(argument).trim();
    const key = value ?? '\u0000';
    const cached = dossierCache.get(key);
    if (cached) return cached;
    const projects = listProjects();
    let found: string;
    if (value === null) found = currentProject(projects);
    else if (!value) throw new Error('aucun dossier');
    else {
      const byId = ID_PREFIX.test(value) ? projects.filter((project) => project.project_id.toLowerCase().startsWith(value.toLowerCase())) : [];
      found = byId.length ? singleMatch(byId) : projectByName(projects, value);
    }
    dossierCache.set(key, found);
    return found;
  };

  database.function('recherche', { deterministic: true }, (label: unknown, aliases: unknown) => searchable([String(label ?? ''), ...parseAliases(aliases)]));
  database.function('dossier', { varargs: true }, (...args: unknown[]) => resolveDossier(args[0]));
  database.function('suivi', () => tracking ? 1 : 0);
  database.function('tic', (count: unknown) => { ticks += Number(count); return 0; });

  const readSecrets = (): string[] => {
    const values = new Set<string>();
    for (const query of SECRET_QUERIES) {
      try {
        for (const value of database.prepare(query).pluck().all()) if (typeof value === 'string' && value.length >= MIN_SECRET_LENGTH) values.add(value);
      } catch {}
    }
    return [...values].sort((a, b) => b.length - a.length);
  };

  const hideSecrets = (output: string, secrets: string[]): string => secrets.reduce((hidden, secret) => hidden.split(secret).join('[secret]'), output);

  const refuseSecretTables = (sql: string): void => {
    if (SECRET_TABLE_PATTERN.test(sql.toLowerCase().replace(/["'`[\]]/g, ''))) throw new Error('accès refusé : table de secrets');
  };

  const revertCodes = (sql: string, dictionary: Dictionary): string => {
    if (dictionary.empty) return sql;
    let safe = escapedReverse.get(dictionary);
    if (!safe) {
      const escape = (value: string): string => value.replace(/'/g, "''");
      safe = { empty: false, reverse: Object.fromEntries(Object.entries(dictionary.reverse).map(([code, variants]) => [code, typeof variants === 'string' ? escape(variants) : variants.map(escape)])) };
      escapedReverse.set(dictionary, safe);
    }
    const kept: string[] = [];
    const remask = (literal: string): string => anonymize(literal.replace(/''/g, "'"), dictionary).replace(/'/g, "''");
    const hidden = sql.replace(CODE_LITERALS, (_, entity: string | undefined, comparison: string | undefined, value: string | undefined) => `${kept.push(entity === undefined ? `${comparison}'${remask(value ?? '')}'` : `entity:${remask(entity)}`) - 1}`);
    return deanonymize(hidden, safe).replace(/(\d+)/g, (_, index: string) => kept[Number(index)]);
  };

  const backupBeforeFirstWrite = async (): Promise<void> => {
    const directory = path.join(dataRoot, 'backups');
    const target = path.join(directory, `auth-${isoWeekLabel(now())}.db`);
    if (fs.existsSync(target)) return;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const partial = `${target}.partial`;
    await database.backup(partial);
    fs.chmodSync(partial, 0o600);
    fs.renameSync(partial, target);
    for (const stale of fs.readdirSync(directory).filter((name) => BACKUP_FILE.test(name)).sort().slice(0, -BACKUPS_KEPT)) fs.rmSync(path.join(directory, stale), { force: true });
  };

  const projectExists = (projectId: string): boolean => Boolean(database.prepare('SELECT 1 FROM projects WHERE project_id=?').get(projectId));

  const recordExclusions = (): void => {
    const deleted = database.prepare('SELECT project_id, label, aliases_json FROM temp.entites_supprimees').all() as Array<{ project_id: string; label: string; aliases_json: string }>;
    const mentions = database.prepare('SELECT project_id, piece, entite, relation FROM temp.mentions_supprimees').all() as Array<{ project_id: string; piece: string; entite: string; relation: string }>;
    const nodeExists = database.prepare('SELECT 1 FROM piecemaker_nodes WHERE project_id=? AND id=?');
    const operations = new Map<string, KnowledgeUpdateOperation[]>();
    const add = (projectId: string, operation: KnowledgeUpdateOperation) => operations.set(projectId, [...(operations.get(projectId) ?? []), operation]);
    for (const row of deleted) for (const term of unique([row.label, ...parseAliases(row.aliases_json)])) add(row.project_id, { op: 'excludeTerm', term });
    for (const row of mentions) if (nodeExists.get(row.project_id, row.piece) && nodeExists.get(row.project_id, row.entite)) add(row.project_id, { op: 'excludeLink', exclusion: { piece: row.piece, entite: row.entite, relation: row.relation } });
    for (const [projectId, projectOperations] of operations) if (projectExists(projectId)) store.update({ projectId, operations: projectOperations });
  };

  const maskNewEntity = (projectId: string, id: string): string | null => {
    const snapshot = store.snapshot(projectId);
    const node = snapshot.nodes.find((candidate) => candidate.id === id);
    if (!node || (node.kind !== 'person' && node.kind !== 'company') || snapshot.mappings.some((mapping) => mapping.nodeId === id)) return null;
    const reals = unique([node.label, ...node.aliases]);
    if (!reals.length) return null;
    const side = text(node.data.partySide);
    const identity: PartyIdentity = { kind: node.kind, legalForm: text(node.data.legalForm), side: side === 'client' || side === 'adversaire' ? side : 'tiers', position: text(node.data.position) };
    const change = partyCodeChange({ id: 'manual:new', kind: node.kind, data: {} }, identity, snapshot.nodes, snapshot.mappings, snapshot.reservedCodes);
    store.update({ projectId, operations: [
      ...(change.nodeId === id ? [] : [{ op: 'renameNode', rename: { fromNodeId: id, toNodeId: change.nodeId } } as KnowledgeUpdateOperation]),
      { op: 'upsertNode', node: { id: change.nodeId, kind: node.kind, label: node.label, aliases: node.aliases, data: { ...node.data, ...change.data } } },
      ...reals.map((real): KnowledgeUpdateOperation => ({ op: 'upsertMapping', mapping: { nodeId: change.nodeId, real, masked: change.code } })),
    ] });
    return change.nodeId;
  };

  const maskNewEntities = (): string[] => {
    const rows = database.prepare('SELECT project_id, id FROM temp.nouvelles_entites').all() as Array<{ project_id: string; id: string }>;
    const lines: string[] = [];
    for (const row of rows) {
      const next = projectExists(row.project_id) ? maskNewEntity(row.project_id, row.id) : null;
      if (next && next !== row.id) lines.push(`nouvel id : ${row.id} → ${next}`);
    }
    return lines;
  };

  const restoreLabel = (projectId: string, id: string, label: string): void => {
    database.prepare('UPDATE piecemaker_nodes SET label=? WHERE project_id=? AND id=?').run(label, projectId, id);
  };

  const applyRenames = async (renames: Array<{ project_id: string; id: string; ancien_label: string; ancien_chemin: string | null }>): Promise<{ lines: string[]; errors: string[] }> => {
    const lines: string[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();
    for (const row of renames) {
      if (seen.has(`${row.project_id}\u0000${row.id}`)) continue;
      seen.add(`${row.project_id}\u0000${row.id}`);
      const current = database.prepare('SELECT label FROM piecemaker_nodes WHERE project_id=? AND id=?').get(row.project_id, row.id) as { label: string } | undefined;
      if (!current || current.label === row.ancien_label) continue;
      try {
        if (!row.ancien_chemin) throw new Error('pièce sans chemin enregistré');
        const extension = path.extname(row.ancien_chemin);
        const name = extension && current.label.toLowerCase().endsWith(extension.toLowerCase()) ? current.label.slice(0, -extension.length) : current.label;
        const renamed = await options.rename(row.project_id, row.ancien_chemin, name);
        if (renamed.current === renamed.previous) {
          restoreLabel(row.project_id, row.id, row.ancien_label);
          continue;
        }
        const created = database.prepare("SELECT id FROM piecemaker_nodes WHERE project_id=? AND kind='document' AND label=? AND id<>?").get(row.project_id, path.basename(renamed.current), row.id) as { id: string } | undefined;
        if (created) lines.push(`nouvel id : ${row.id} → ${created.id}`);
      } catch (error) {
        restoreLabel(row.project_id, row.id, row.ancien_label);
        errors.push(`renommage refusé, libellé restauré (${row.ancien_label}) : ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { lines, errors };
  };

  const write = async (statement: Statement | null, sql: string): Promise<string> => {
    await backupBeforeFirstWrite();
    database.exec(TEMP_SCHEMA);
    database.exec(CLEAR_TEMP_TABLES);
    ticks = 0;
    let table: { columns: string[]; rows: SqlValue[][] } | null = null;
    let renames: Array<{ project_id: string; id: string; ancien_label: string; ancien_chemin: string | null }> = [];
    let created: string[] = [];
    let changes = 0;
    database.exec('BEGIN IMMEDIATE');
    try {
      tracking = true;
      if (statement?.reader) {
        table = { columns: statement.columns().map((column) => column.name), rows: statement.raw().all() as SqlValue[][] };
        changes = Number(database.prepare('SELECT changes()').pluck().get());
      } else if (statement) {
        changes = statement.run().changes;
      } else {
        const before = Number(database.prepare('SELECT total_changes()').pluck().get());
        database.exec(sql);
        changes = Number(database.prepare('SELECT total_changes()').pluck().get()) - before - ticks;
      }
      tracking = false;
      renames = database.prepare('SELECT project_id, id, ancien_label, ancien_chemin FROM temp.renommages').all() as typeof renames;
      recordExclusions();
      created = maskNewEntities();
      database.exec('COMMIT');
    } catch (error) {
      tracking = false;
      if (database.inTransaction) database.exec('ROLLBACK');
      throw error;
    }
    const renamed = await applyRenames(renames);
    dictionarySource.refresh();
    const output = [...(table ? [renderTable(table.columns, table.rows, dictionarySource.getForOutbound())] : []), `${changes} ligne(s) modifiée(s)`, ...created, ...renamed.lines];
    if (renamed.errors.length) throw new Error([...output, ...renamed.errors].join('\n'));
    return output.join('\n');
  };

  const perform = async ({ requete, cwd }: SqlToolInput, dictionary: Dictionary): Promise<string> => {
    const sql = typeof requete === 'string' ? requete.trim() : '';
    if (!sql) throw new Error('requête vide');
    refuseSecretTables(sql);
    const reverted = revertCodes(sql, dictionary);
    if (reverted !== sql) refuseSecretTables(reverted);
    if (TRANSACTION_CONTROL.test(stripComments(reverted))) throw new Error('BEGIN, COMMIT, ROLLBACK et SAVEPOINT refusés : chaque requête est déjà une transaction');
    currentCwd = cwd;
    dossierCache.clear();
    let statement: Statement | null = null;
    try {
      statement = database.prepare(reverted);
    } catch (error) {
      if (!(error instanceof RangeError && /more than one statement/.test(error.message))) throw error;
    }
    if (!statement || !statement.readonly) return write(statement, reverted);
    if (!statement.reader) {
      statement.run();
      return '0 ligne(s) modifiée(s)';
    }
    const columns = statement.columns().map((column) => column.name);
    return renderTable(columns, statement.raw().all() as SqlValue[][], dictionary);
  };

  const execute = (input: SqlToolInput): Promise<string> => {
    const task = queue.then(async () => {
      const secrets = readSecrets();
      let dictionary = dictionarySource.getForOutbound();
      try {
        const result = await perform(input, dictionary);
        return hideSecrets(result, secrets);
      } catch (error) {
        dictionary = dictionarySource.getForOutbound();
        throw new Error(hideSecrets(anonymize(error instanceof Error ? error.message : String(error), dictionary), secrets));
      }
    });
    queue = task.catch(() => undefined);
    return task;
  };

  return {
    execute,
    close(): void {
      database.close();
      lookup.close();
      if (ownsDictionary) dictionarySource.close?.();
    },
  };
}
