import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

import Database from 'better-sqlite3';

import { parseFrontMatter } from '@/shared/frontmatter.js';

import { parseConnectorConfig, prepareConnectorInstallation, type LibraryConnectorConfig } from './connector-installation.js';
import { personalComponentMatcher, personalSkillClassifier, type PersonalSkillOrigin } from './personal.js';
import { componentFolderName, prepareWorkspaceInstallation, PreservedComponentError, type SkillTarget } from './workspace-installation.js';

type StoredLibraryEntry = {
  id: string;
  kind: 'skill' | 'agent' | 'connector';
  name: string;
  description: string;
  content: string;
  assets: string;
};

type LibraryConnectorInput = {
  name: string;
  description: string;
  config: LibraryConnectorConfig;
  source: string;
  namespace?: string;
};

type LibraryEntry = Omit<StoredLibraryEntry, 'assets'> & { assets: Record<string, string> };

type LibraryCollectionEntry = {
  entryId: string;
  rootPath: string;
};

type LibraryCollectionInput = {
  id: string;
  name: string;
  description: string;
  source: string;
  entries: LibraryCollectionEntry[];
  files: Array<{ path: string; content: Buffer }>;
};

const MAX_EDITABLE_FILE_BYTES = 1024 * 1024;
const NOT_TOGGLEABLE = 'Élément personnel actif partout : désactivation par dossier non prise en charge.';

type LibraryOrigin = 'personnel' | 'dossier' | 'bibliothèque';

// État d'un skill dans un dossier : natif (personnel ou local), réglage explicite éventuel, état effectif.
type SkillState = {
  id: string;
  name: string;
  origins: string[];
  personal: boolean;
  local: boolean;
  claudeOrigin: boolean;
  agentsOrigin: boolean;
  claudeOrigins: string[];
  native: boolean;
  explicit: 'on' | 'off' | null;
  enabled: boolean;
};

function describeSkill(selected: string, row: { id: string; name: string }, origins: string[], classify: (source: string) => PersonalSkillOrigin, on: boolean, off: boolean): SkillState {
  const prefix = selected ? `${selected}${path.sep}` : '';
  const claudeLocal = selected ? path.join(selected, '.claude', 'skills') + path.sep : '';
  let personal = false;
  let claudeOrigin = false;
  let agentsOrigin = false;
  const claudeOrigins: string[] = [];
  for (const origin of origins) {
    const kind = classify(origin);
    personal ||= kind.personal;
    claudeOrigin ||= kind.claude;
    agentsOrigin ||= kind.agents;
    if (kind.claude || (claudeLocal && origin.startsWith(claudeLocal))) claudeOrigins.push(origin);
  }
  const local = Boolean(prefix) && origins.some((origin) => origin.startsWith(prefix));
  const native = personal || local;
  const explicit = off ? 'off' : on ? 'on' : null;
  return { id: row.id, name: row.name, origins, personal, local, claudeOrigin, agentsOrigin, claudeOrigins, native, explicit, enabled: Boolean(selected) && (explicit ? explicit === 'on' : native) };
}

// Liens à poser dans le dossier pour qu'un skill personnel actif soit lu par tous les providers.
function coverageTargets(state: SkillState): SkillTarget[] {
  if (!state.personal) return [];
  return [...(state.claudeOrigin ? [] : ['.claude' as const]), ...(state.agentsOrigin ? [] : ['.agents' as const])];
}

function normalizedCollectionPath(value: string) {
  const normalized = value.trim().replace(/\\/g, '/');
  const segments = normalized.split('/');
  if (!normalized || path.isAbsolute(normalized) || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Chemin de fichier invalide.');
  }
  return segments.join('/');
}

function decodeUtf8File(bytes: Buffer) {
  if (bytes.includes(0)) throw new Error('Ce fichier ne peut pas être modifié.');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('Ce fichier ne peut pas être modifié.'); }
}

function decodeEditableFile(bytes: Buffer) {
  if (bytes.length > MAX_EDITABLE_FILE_BYTES) throw new Error('Ce fichier ne peut pas être modifié.');
  return decodeUtf8File(bytes);
}

function installationFolder(content: string, fallback = '') {
  const { data } = parseFrontMatter(content);
  return componentFolderName(String(data.name || data.metadata?.title || fallback));
}

function collectionMainPath(entry: LibraryEntry, rootPath: string) {
  return entry.kind === 'skill' && !rootPath.toLowerCase().endsWith('.md') ? `${rootPath}/SKILL.md` : rootPath;
}

export function createLibraryStore(home: string, { userHome = os.homedir() }: { userHome?: string } = {}) {
  const directory = path.join(home, 'library-backend');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, 'catalog.sqlite');
  const db = new Database(filename);
  fs.chmodSync(filename, 0o600);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
      description TEXT NOT NULL, content TEXT NOT NULL, assets TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS origins (
      source TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES entries(id), source_hash TEXT
    );
    CREATE TABLE IF NOT EXISTS deleted_origins (source TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS activation (
      workspace TEXT NOT NULL, entry_id TEXT NOT NULL REFERENCES entries(id),
      PRIMARY KEY(workspace, entry_id)
    );
    CREATE TABLE IF NOT EXISTS deactivation (
      workspace TEXT NOT NULL, entry_id TEXT NOT NULL REFERENCES entries(id),
      PRIMARY KEY(workspace, entry_id)
    );
    CREATE TABLE IF NOT EXISTS installation (
      workspace TEXT NOT NULL, entry_id TEXT NOT NULL REFERENCES entries(id),
      PRIMARY KEY(workspace, entry_id)
    );
    CREATE TABLE IF NOT EXISTS skill_overrides (
      workspace TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(workspace, name)
    );
    CREATE TABLE IF NOT EXISTS skill_override_files (workspace TEXT PRIMARY KEY, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, source TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS collection_entries (
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      entry_id TEXT NOT NULL REFERENCES entries(id), root_path TEXT NOT NULL,
      PRIMARY KEY(collection_id, entry_id, root_path)
    );
    CREATE TABLE IF NOT EXISTS collection_files (
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      path TEXT NOT NULL, content BLOB NOT NULL,
      PRIMARY KEY(collection_id, path)
    );
  `);
  const originColumns = db.prepare('PRAGMA table_info(origins)').all() as Array<{ name: string }>;
  if (!originColumns.some((column) => column.name === 'source_hash')) db.exec('ALTER TABLE origins ADD COLUMN source_hash TEXT');

  function workspace(value: unknown) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Dossier absolu requis.');
    const resolved = fs.realpathSync(value);
    if (!fs.statSync(resolved).isDirectory()) throw new Error('Dossier introuvable.');
    return resolved;
  }

  function document(id: string) {
    const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as StoredLibraryEntry | undefined;
    if (!entry) throw new Error('Élément introuvable.');
    return { ...entry, assets: JSON.parse(entry.assets) as Record<string, string> };
  }

  function originsByEntry(kind?: StoredLibraryEntry['kind']) {
    const rows = (kind
      ? db.prepare('SELECT o.entry_id AS entryId, o.source FROM origins o JOIN entries e ON e.id = o.entry_id WHERE e.kind = ?').all(kind)
      : db.prepare('SELECT entry_id AS entryId, source FROM origins').all()) as Array<{ entryId: string; source: string }>;
    const origins = new Map<string, string[]>();
    for (const row of rows) origins.set(row.entryId, [...(origins.get(row.entryId) ?? []), row.source]);
    return origins;
  }

  function entryIds(table: 'activation' | 'deactivation' | 'installation', selected: string) {
    if (!selected) return new Set<string>();
    return new Set((db.prepare(`SELECT entry_id AS entryId FROM ${table} WHERE workspace = ?`).all(selected) as Array<{ entryId: string }>).map((row) => row.entryId));
  }

  // États des skills du catalogue dans le dossier (chaîne vide : hors dossier). Aucune lecture de contenu.
  function skillStates(selected: string): SkillState[] {
    const classify = personalSkillClassifier(userHome);
    const origins = originsByEntry('skill');
    const on = entryIds('activation', selected);
    const off = entryIds('deactivation', selected);
    return (db.prepare("SELECT id, name FROM entries WHERE kind = 'skill' ORDER BY name COLLATE NOCASE").all() as Array<{ id: string; name: string }>)
      .map((row) => describeSkill(selected, row, origins.get(row.id) ?? [], classify, on.has(row.id), off.has(row.id)));
  }

  function skillStateOf(selected: string, id: string) {
    const origins = (db.prepare('SELECT source FROM origins WHERE entry_id = ?').all(id) as Array<{ source: string }>).map((row) => row.source);
    const on = Boolean(db.prepare('SELECT 1 FROM activation WHERE workspace = ? AND entry_id = ?').get(selected, id));
    const off = Boolean(db.prepare('SELECT 1 FROM deactivation WHERE workspace = ? AND entry_id = ?').get(selected, id));
    return describeSkill(selected, { id, name: '' }, origins, personalSkillClassifier(userHome), on, off);
  }

  // Un agent ou un connecteur personnel est actif partout : PieceMaker ne peut pas le désactiver par dossier.
  function isPersonalComponent(kind: StoredLibraryEntry['kind'], origins: string[], matcher = personalComponentMatcher(userHome)) {
    if (kind === 'agent') return origins.some(matcher.agent);
    if (kind === 'connector') return origins.some(matcher.connector);
    return false;
  }

  function list(workspacePath?: string) {
    const selected = workspacePath ? workspace(workspacePath) : '';
    const classify = personalSkillClassifier(userHome);
    const matcher = personalComponentMatcher(userHome);
    const origins = originsByEntry();
    const on = entryIds('activation', selected);
    const off = entryIds('deactivation', selected);
    return db.prepare(`SELECT e.id, e.kind, e.name, e.description,
      (SELECT ce.collection_id FROM collection_entries ce WHERE ce.entry_id = e.id LIMIT 1) AS collectionId
      FROM entries e ORDER BY e.name COLLATE NOCASE`).all().map((row) => {
        const entry = row as Omit<StoredLibraryEntry, 'content' | 'assets'> & { collectionId: string | null };
        const sources = origins.get(entry.id) ?? [];
        const base = { ...entry, collectionId: entry.collectionId || null };
        if (entry.kind === 'skill') {
          const state = describeSkill(selected, entry, sources, classify, on.has(entry.id), off.has(entry.id));
          const origin: LibraryOrigin = state.personal ? 'personnel' : state.local ? 'dossier' : 'bibliothèque';
          return { ...base, enabled: state.enabled, native: state.native, origin, toggleable: true };
        }
        if (isPersonalComponent(entry.kind, sources, matcher)) {
          return { ...base, enabled: Boolean(selected), native: true, origin: 'personnel' as LibraryOrigin, toggleable: false };
        }
        return { ...base, enabled: on.has(entry.id), native: false, origin: 'bibliothèque' as LibraryOrigin, toggleable: true };
      });
  }

  function persistImportedEntry(source: string, kind: StoredLibraryEntry['kind'], name: string, description: string, content: string, assets: Record<string, string>, id: string) {
    const serialized = JSON.stringify(Object.fromEntries(Object.entries(assets).sort(([left], [right]) => left.localeCompare(right))));
    const sourceHash = createHash('sha256').update(`${kind}\0${content}\0${serialized}`).digest('hex');
    const originSource = !path.isAbsolute(source) || source.includes('#') ? source : path.resolve(source);
    if (db.prepare('SELECT 1 FROM deleted_origins WHERE source = ?').get(originSource)) return null;
    const existingOrigin = db.prepare('SELECT entry_id AS entryId, source_hash AS sourceHash FROM origins WHERE source = ?').get(originSource) as { entryId: string; sourceHash: string | null } | undefined;
    if (existingOrigin) {
      if (existingOrigin.sourceHash === null || existingOrigin.sourceHash === sourceHash) return existingOrigin.entryId;
      const existingEntry = document(existingOrigin.entryId);
      const existingAssets = JSON.stringify(Object.fromEntries(Object.entries(existingEntry.assets).sort(([left], [right]) => left.localeCompare(right))));
      const existingHash = createHash('sha256').update(`${existingEntry.kind}\0${existingEntry.content}\0${existingAssets}`).digest('hex');
      if (existingHash !== existingOrigin.sourceHash) return existingOrigin.entryId;
      db.transaction(() => {
        db.prepare('UPDATE entries SET name = ?, description = ?, content = ?, assets = ? WHERE id = ?').run(name, description, content, serialized, existingOrigin.entryId);
        db.prepare('UPDATE origins SET source_hash = ? WHERE source = ?').run(sourceHash, originSource);
      })();
      return existingOrigin.entryId;
    }
    db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO entries VALUES (?, ?, ?, ?, ?, ?)').run(id, kind, name, description, content, serialized);
      db.prepare('INSERT INTO origins (source, entry_id, source_hash) VALUES (?, ?, ?)').run(originSource, id, sourceHash);
    })();
    return id;
  }

  function importFile(source: string, kind: 'skill' | 'agent', includeAssets = true) {
    const resolved = fs.realpathSync(source);
    const content = decodeUtf8File(fs.readFileSync(resolved));
    const parsed = parseFrontMatter(content);
    const data = parsed.data;
    const sourceName = path.basename(source).toLowerCase() === 'skill.md'
      ? path.basename(path.dirname(source))
      : path.basename(source, path.extname(source));
    const name = String(data.metadata?.title || data.name || sourceName);
    const description = typeof data.description === 'string' ? data.description : '';
    const assets: Record<string, string> = {};
    let total = Buffer.byteLength(content);
    function collect(root: string, relative = '') {
      for (const child of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
        if (child.name === '.git' || child.name === 'node_modules' || child.name === '__pycache__') continue;
        const key = path.posix.join(relative.split(path.sep).join('/'), child.name);
        const file = path.join(root, key);
        if (child.isSymbolicLink()) throw new Error(`Fichier associé lié non importé : ${file}`);
        if (child.isDirectory()) collect(root, key);
        else if (child.isFile() && fs.realpathSync(file) !== resolved) {
          const bytes = fs.readFileSync(file);
          total += bytes.length;
          if (total > 30 * 1024 * 1024) throw new Error(`Skill trop volumineuse : ${name}`);
          assets[key] = bytes.toString('base64');
        }
      }
    }
    if (kind === 'skill' && includeAssets) collect(path.dirname(resolved));
    const id = createHash('sha256').update(`${kind}\0${content}\0${JSON.stringify(Object.fromEntries(Object.entries(assets).sort(([left], [right]) => left.localeCompare(right))))}`).digest('hex');
    return persistImportedEntry(resolved, kind, name, description, content, assets, id);
  }

  function importContent(source: string, kind: 'skill' | 'agent', content: string) {
    const parsed = parseFrontMatter(content);
    const data = parsed.data;
    const sourceName = path.basename(source, path.extname(source));
    const name = String(data.metadata?.title || data.name || sourceName);
    const description = typeof data.description === 'string' ? data.description : '';
    const id = createHash('sha256').update(`${kind}\0${content}\0{}`).digest('hex');
    return persistImportedEntry(source, kind, name, description, content, {}, id);
  }

  function importConnector(input: LibraryConnectorInput) {
    const name = input.name.trim();
    if (!name) throw new Error('Nom requis.');
    const content = `${JSON.stringify(input.config, null, 2)}\n`;
    const description = input.description.trim() || (input.config.url || input.config.command || name);
    const id = createHash('sha256').update(`connector\0${input.namespace || ''}\0${name}`).digest('hex');
    return persistImportedEntry(input.source, 'connector', name, description, content, {}, id);
  }

  function createEntry(kind: 'skill' | 'agent', name: string, description: string) {
    const trimmedName = name.replace(/\s+/g, ' ').trim();
    if (!trimmedName) throw new Error('Nom requis.');
    const trimmedDescription = description.trim();
    const id = randomBytes(32).toString('hex');
    const body = kind === 'agent' ? 'Rôle et instructions de l’agent à rédiger ici.' : 'Instructions du skill à rédiger ici.';
    const content = `---\nname: ${JSON.stringify(trimmedName)}\ndescription: ${JSON.stringify(trimmedDescription)}\n---\n${body}\n`;
    db.prepare('INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?)').run(id, kind, trimmedName, trimmedDescription, content, '{}');
    return document(id);
  }

  // Dossiers où l'élément est installé (activation explicite ou liens de couverture) et qui existent encore.
  function installedWorkspaces(id: string) {
    const rows = db.prepare('SELECT workspace FROM activation WHERE entry_id = ? UNION SELECT workspace FROM installation WHERE entry_id = ?').all(id, id) as Array<{ workspace: string }>;
    return rows.map((row) => resolveWorkspace(row.workspace)).filter((selected): selected is string => Boolean(selected));
  }

  // Retire l'installation d'un élément dans un dossier, sans toucher aux réglages d'activation (skills) ou en les retirant (agents, connecteurs).
  function removeInstallation(selected: string, id: string) {
    const entry = document(id);
    if (entry.kind === 'skill') materialize(selected, entry, false);
    else setRawEnabled(selected, entry, false);
  }

  // Réécrit l'installation d'un élément dans un dossier après modification de son contenu.
  function refreshInstallation(selected: string, id: string) {
    const entry = document(id);
    if (entry.kind !== 'skill') { setRawEnabled(selected, entry, true); return; }
    const state = skillStateOf(selected, id);
    if (!state.enabled) { db.prepare('DELETE FROM installation WHERE workspace = ? AND entry_id = ?').run(selected, id); return; }
    // Activation explicite : installation complète ; skill natif : liens de couverture seulement.
    const targets = state.explicit === 'on' ? undefined : coverageTargets(state);
    if (targets?.length === 0) return;
    materialize(selected, entry, true, targets, state.explicit !== 'on');
    db.prepare('INSERT OR IGNORE INTO installation VALUES (?, ?)').run(selected, id);
  }

  function updateDocument(id: string, content: string, previousContent: string) {
    return db.transaction(() => {
      const entry = document(id);
      if (entry.content !== previousContent) throw new Error('Le document a été modifié ailleurs. Rouvrez-le avant d’enregistrer.');
      const active = installedWorkspaces(id);
      if (entry.kind !== 'connector' && installationFolder(content) !== installationFolder(entry.content)) {
        for (const selected of active) removeInstallation(selected, id);
      }
      if (entry.kind === 'connector') {
        const config = parseConnectorConfig(content);
        const description = config.url || config.command || entry.name;
        db.prepare('UPDATE entries SET description = ?, content = ? WHERE id = ?').run(description, `${JSON.stringify(config, null, 2)}\n`, id);
      } else {
        const { data } = parseFrontMatter(content);
        const name = String(data.metadata?.title || data.name || entry.name);
        const description = typeof data.description === 'string' ? data.description : '';
        db.prepare('UPDATE entries SET name = ?, description = ?, content = ? WHERE id = ?').run(name, description, content, id);
      }
      for (const selected of active) refreshInstallation(selected, id);
      return document(id);
    })();
  }

  function deleteEntry(id: string) {
    const entry = document(id);
    if (entry.kind !== 'skill') throw new Error('Seuls les skills peuvent être supprimés.');
    for (const selected of installedWorkspaces(id)) removeInstallation(selected, id);
    db.transaction(() => {
      db.prepare('DELETE FROM collection_entries WHERE entry_id = ?').run(id);
      db.prepare('INSERT OR IGNORE INTO deleted_origins (source) SELECT source FROM origins WHERE entry_id = ?').run(id);
      db.prepare('DELETE FROM origins WHERE entry_id = ?').run(id);
      db.prepare('DELETE FROM activation WHERE entry_id = ?').run(id);
      db.prepare('DELETE FROM deactivation WHERE entry_id = ?').run(id);
      db.prepare('DELETE FROM installation WHERE entry_id = ?').run(id);
      db.prepare('DELETE FROM entries WHERE id = ?').run(id);
    })();
    return { ok: true };
  }

  function updateAsset(id: string, assetPath: string, content: string, previousContent: string) {
    return db.transaction(() => {
      const entry = document(id);
      const normalized = normalizedCollectionPath(assetPath);
      const encoded = entry.assets[normalized];
      if (typeof encoded !== 'string') throw new Error('Fichier introuvable.');
      const currentContent = decodeEditableFile(Buffer.from(encoded, 'base64'));
      if (currentContent !== previousContent) throw new Error('Le fichier a été modifié ailleurs. Rouvrez-le avant d’enregistrer.');
      const bytes = Buffer.from(content, 'utf8');
      if (bytes.length > MAX_EDITABLE_FILE_BYTES || content.includes('\0')) throw new Error('Ce fichier ne peut pas être modifié.');
      const assets = { ...entry.assets, [normalized]: bytes.toString('base64') };
      db.prepare('UPDATE entries SET assets = ? WHERE id = ?').run(JSON.stringify(assets), id);
      for (const selected of installedWorkspaces(id)) refreshInstallation(selected, id);
      return { path: normalized, content };
    })();
  }

  function upsertCollection(input: LibraryCollectionInput) {
    if (!input.id || (!input.entries.length && !input.files.length && !input.source)) return null;
    return db.transaction(() => {
      db.prepare(`INSERT INTO collections (id, name, description, source) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, source = excluded.source`)
        .run(input.id, input.name, input.description, input.source);
      db.prepare('DELETE FROM collection_entries WHERE collection_id = ?').run(input.id);
      const insert = db.prepare('INSERT INTO collection_entries (collection_id, entry_id, root_path) VALUES (?, ?, ?)');
      for (const entry of input.entries) insert.run(input.id, entry.entryId, normalizedCollectionPath(entry.rootPath));
      if (input.files.length) {
        db.prepare('DELETE FROM collection_files WHERE collection_id = ?').run(input.id);
        const insertFile = db.prepare('INSERT INTO collection_files (collection_id, path, content) VALUES (?, ?, ?)');
        for (const file of input.files) insertFile.run(input.id, normalizedCollectionPath(file.path), file.content);
      }
      return input.id;
    })();
  }

  function collectionEntries(id: string) {
    return db.prepare(`SELECT ce.entry_id AS entryId, ce.root_path AS rootPath
      FROM collection_entries ce WHERE ce.collection_id = ? ORDER BY ce.root_path COLLATE NOCASE`)
      .all(id) as LibraryCollectionEntry[];
  }

  function listCollections(workspacePath?: string) {
    const selected = workspacePath ? workspace(workspacePath) : '';
    const states = new Map(selected ? list(selected).map((entry) => [entry.id, entry.enabled] as const) : []);
    const members = new Map<string, string[]>();
    for (const row of db.prepare('SELECT collection_id AS collectionId, entry_id AS entryId FROM collection_entries').all() as Array<{ collectionId: string; entryId: string }>) {
      members.set(row.collectionId, [...(members.get(row.collectionId) ?? []), row.entryId]);
    }
    return db.prepare('SELECT id, name, description, source FROM collections ORDER BY name COLLATE NOCASE').all().map((row) => {
      const collection = row as { id: string; name: string; description: string; source: string };
      const entries = members.get(collection.id) ?? [];
      const enabledCount = entries.filter((entryId) => states.get(entryId)).length;
      return {
        id: collection.id,
        name: collection.name,
        description: collection.description,
        source: collection.source,
        enabled: entries.length > 0 && enabledCount === entries.length,
        partial: enabledCount > 0 && enabledCount < entries.length,
        componentCount: entries.length,
      };
    });
  }

  function collectionSource(id: string): string | null {
    const row = db.prepare('SELECT source FROM collections WHERE id = ?').get(id) as { source: string } | undefined;
    return row?.source || null;
  }

  function collectSourceFiles(source: string): Array<{ path: string; content: Buffer }> {
    const root = fs.realpathSync(source);
    const files: Array<{ path: string; content: Buffer }> = [];
    let totalSize = 0;
    const walk = (directory: string, relative = '') => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '__pycache__' || entry.isSymbolicLink()) continue;
        const relativePath = path.posix.join(relative.split(path.sep).join('/'), entry.name);
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(absolutePath, relativePath);
        else if (entry.isFile()) {
          const content = fs.readFileSync(absolutePath);
          totalSize += content.length;
          if (totalSize > 30 * 1024 * 1024 || files.length >= 5000) throw new Error(`Plugin trop volumineux : ${path.basename(root)}`);
          files.push({ path: relativePath, content });
        }
      }
    };
    walk(root);
    return files;
  }

  function ensureCollectionFiles(id: string) {
    const stored = db.prepare('SELECT 1 FROM collection_files WHERE collection_id = ? LIMIT 1').get(id);
    if (stored) return;
    const source = collectionSource(id);
    if (!source || !fs.existsSync(source) || fs.lstatSync(source).isSymbolicLink()) return;
    const files = collectSourceFiles(source);
    if (!files.length) return;
    const insertFile = db.prepare('INSERT INTO collection_files (collection_id, path, content) VALUES (?, ?, ?)');
    db.transaction(() => {
      for (const file of files) insertFile.run(id, normalizedCollectionPath(file.path), file.content);
    })();
  }

  function collectionFiles(id: string) {
    ensureCollectionFiles(id);
    const files = new Map<string, { path: string; size: number; editable: boolean }>();
    const storedFiles = db.prepare('SELECT path, content FROM collection_files WHERE collection_id = ?').all(id) as Array<{ path: string; content: Buffer }>;
    for (const file of storedFiles) {
      let editable = false;
      try { decodeEditableFile(file.content); editable = true; } catch {}
      files.set(file.path, { path: file.path, size: file.content.length, editable });
    }
    for (const mapping of collectionEntries(id)) {
      const entry = document(mapping.entryId);
      const mainPath = collectionMainPath(entry, mapping.rootPath);
      const mainBytes = Buffer.from(entry.content, 'utf8');
      let mainEditable = false;
      try { decodeEditableFile(mainBytes); mainEditable = true; } catch {}
      files.set(mainPath, { path: mainPath, size: mainBytes.length, editable: mainEditable });
      if (entry.kind === 'skill') {
        for (const [assetPath, encoded] of Object.entries(entry.assets)) {
          const bytes = Buffer.from(encoded, 'base64');
          let editable = false;
          try { decodeEditableFile(bytes); editable = true; } catch {}
          const filePath = `${mapping.rootPath}/${assetPath}`;
          files.set(filePath, { path: filePath, size: bytes.length, editable });
        }
      }
    }
    return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
  }

  function collectionFile(id: string, filePath: string) {
    ensureCollectionFiles(id);
    const normalized = normalizedCollectionPath(filePath);
    for (const mapping of collectionEntries(id)) {
      const entry = document(mapping.entryId);
      const mainPath = collectionMainPath(entry, mapping.rootPath);
      if (normalized === mainPath) return { name: path.basename(normalized), path: normalized, content: decodeEditableFile(Buffer.from(entry.content, 'utf8')) };
      const prefix = `${mapping.rootPath}/`;
      if (entry.kind === 'skill' && normalized.startsWith(prefix)) {
        const assetPath = normalized.slice(prefix.length);
        const encoded = entry.assets[assetPath];
        if (typeof encoded === 'string') return { name: path.basename(normalized), path: normalized, content: decodeEditableFile(Buffer.from(encoded, 'base64')) };
      }
    }
    const stored = db.prepare('SELECT content FROM collection_files WHERE collection_id = ? AND path = ?').get(id, normalized) as { content: Buffer } | undefined;
    if (stored) return { name: path.basename(normalized), path: normalized, content: decodeEditableFile(stored.content) };
    throw new Error('Fichier introuvable.');
  }

  function updateCollectionFile(id: string, filePath: string, content: string, previousContent: string) {
    if (typeof content !== 'string' || typeof previousContent !== 'string') throw new Error('Contenu et version précédente requis.');
    ensureCollectionFiles(id);
    const normalized = normalizedCollectionPath(filePath);
    for (const mapping of collectionEntries(id)) {
      const entry = document(mapping.entryId);
      const mainPath = collectionMainPath(entry, mapping.rootPath);
      if (normalized === mainPath) {
        decodeEditableFile(Buffer.from(entry.content, 'utf8'));
        decodeEditableFile(Buffer.from(content, 'utf8'));
        return updateDocument(mapping.entryId, content, previousContent);
      }
      const prefix = `${mapping.rootPath}/`;
      if (entry.kind === 'skill' && normalized.startsWith(prefix)) {
        return updateAsset(mapping.entryId, normalized.slice(prefix.length), content, previousContent);
      }
    }
    const stored = db.prepare('SELECT content FROM collection_files WHERE collection_id = ? AND path = ?').get(id, normalized) as { content: Buffer } | undefined;
    if (stored) {
      const currentContent = decodeEditableFile(stored.content);
      if (currentContent !== previousContent) throw new Error('Le fichier a été modifié ailleurs. Rouvrez-le avant d’enregistrer.');
      const bytes = Buffer.from(content, 'utf8');
      if (bytes.length > MAX_EDITABLE_FILE_BYTES || content.includes('\0')) throw new Error('Ce fichier ne peut pas être modifié.');
      db.prepare('UPDATE collection_files SET content = ? WHERE collection_id = ? AND path = ?').run(bytes, id, normalized);
      return { path: normalized, content };
    }
    throw new Error('Fichier introuvable.');
  }

  function setCollectionEnabled(workspacePath: unknown, id: string, enabled: unknown) {
    if (typeof enabled !== 'boolean') throw new Error('Activation booléenne requise.');
    const selected = workspace(workspacePath);
    const mappings = collectionEntries(id);
    if (!mappings.length) throw new Error('Plugin introuvable.');
    const states = new Map(list(selected).map((entry) => [entry.id, entry] as const));
    const changed: string[] = [];
    try {
      for (const mapping of mappings) {
        const state = states.get(mapping.entryId);
        if (!state?.toggleable || state.enabled === enabled || changed.includes(mapping.entryId)) continue;
        setEnabled(selected, mapping.entryId, enabled);
        changed.push(mapping.entryId);
      }
    } catch (error) {
      for (const entryId of changed.reverse()) setEnabled(selected, entryId, !enabled);
      throw error;
    }
    return listCollections(selected).find((collection) => collection.id === id);
  }

  // Extrait ou retire les fichiers d'un élément dans le dossier ; retourne les cibles conservées (composants personnels).
  // `targets` restreint les dossiers de skills (défaut : tous) ; `tolerant` : un composant déjà présent n'est pas une erreur.
  function materialize(selected: string, entry: LibraryEntry, enabled: boolean, targets?: readonly SkillTarget[], tolerant = false) {
    const { id } = entry;
    const packageRoot = path.join(directory, 'active', createHash('sha256').update(selected).digest('hex'), id);
    const { data: frontMatter } = parseFrontMatter(entry.content);
    let install: ReturnType<typeof prepareWorkspaceInstallation>;
    try {
      install = prepareWorkspaceInstallation(selected, id, String(frontMatter.name || frontMatter.metadata?.title || entry.name), packageRoot, entry.kind as 'skill' | 'agent', enabled, targets);
    } catch (error) {
      if (tolerant && error instanceof PreservedComponentError) return [error.target];
      throw error;
    }
    let skipped: string[] = [];
    if (enabled) {
      fs.mkdirSync(path.dirname(packageRoot), { recursive: true, mode: 0o700 });
      if (!fs.realpathSync(path.dirname(packageRoot)).startsWith(fs.realpathSync(directory) + path.sep)) throw new Error('Répertoire d’activation non autorisé.');
      const staging = fs.mkdtempSync(path.join(directory, '.activation-'));
      const backup = `${staging}.previous`;
      try {
        for (const [relative, bytes] of Object.entries(entry.assets)) {
          const target = path.resolve(staging, relative);
          if (!target.startsWith(staging + path.sep)) throw new Error('Chemin associé invalide.');
          fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
          fs.writeFileSync(target, Buffer.from(bytes, 'base64'), { mode: 0o600 });
        }
        if (entry.kind === 'skill') fs.writeFileSync(path.join(staging, 'SKILL.md'), entry.content, { mode: 0o600 });
        else {
          fs.writeFileSync(path.join(staging, 'agent.md'), entry.content, { mode: 0o600 });
          const { data, content } = parseFrontMatter(entry.content);
          const toml = Object.entries({ name: String(data.name || entry.name), description: entry.description || entry.name, developer_instructions: content })
            .map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n');
          fs.writeFileSync(path.join(staging, 'agent.toml'), `${toml}\n`, { mode: 0o600 });
        }
        if (fs.existsSync(packageRoot)) fs.renameSync(packageRoot, backup);
        try {
          fs.renameSync(staging, packageRoot);
          ({ skipped } = install());
        }
        catch (error) {
          fs.rmSync(packageRoot, { recursive: true, force: true });
          if (fs.existsSync(backup)) fs.renameSync(backup, packageRoot);
          throw error;
        }
      } finally {
        fs.rmSync(staging, { recursive: true, force: true });
        fs.rmSync(backup, { recursive: true, force: true });
      }
    } else if (fs.existsSync(path.dirname(packageRoot))) {
      if (!fs.realpathSync(path.dirname(packageRoot)).startsWith(fs.realpathSync(directory) + path.sep)) throw new Error('Répertoire d’activation non autorisé.');
      ({ skipped } = install());
      fs.rmSync(packageRoot, { recursive: true, force: true });
    } else {
      ({ skipped } = install());
    }
    return skipped;
  }

  function setRawEnabled(selected: string, entry: LibraryEntry, enabled: boolean) {
    if (entry.kind === 'connector') {
      prepareConnectorInstallation(selected, entry.name, parseConnectorConfig(entry.content), enabled)();
      if (enabled) db.prepare('INSERT OR IGNORE INTO activation VALUES (?, ?)').run(selected, entry.id);
      else db.prepare('DELETE FROM activation WHERE workspace = ? AND entry_id = ?').run(selected, entry.id);
      return { ok: true, enabled, skipped: [] as string[] };
    }
    const skipped = materialize(selected, entry, enabled);
    if (enabled) db.prepare('INSERT OR IGNORE INTO activation VALUES (?, ?)').run(selected, entry.id);
    else db.prepare('DELETE FROM activation WHERE workspace = ? AND entry_id = ?').run(selected, entry.id);
    return { ok: true, enabled, skipped };
  }

  // Skill : état explicite par rapport au défaut (activé si natif, désactivé sinon) ; revenir au défaut retire le réglage.
  function setSkillEnabled(selected: string, entry: LibraryEntry, enabled: boolean) {
    const state = skillStateOf(selected, entry.id);
    const forget = (table: 'activation' | 'deactivation' | 'installation') => db.prepare(`DELETE FROM ${table} WHERE workspace = ? AND entry_id = ?`).run(selected, entry.id);
    let skipped: string[] = [];
    if (enabled && state.native) {
      // Natif : seuls les liens manquants pour que tous les providers le lisent sont posés.
      const targets = coverageTargets(state);
      if (targets.length) skipped = materialize(selected, entry, true, targets, true);
      db.transaction(() => {
        forget('activation');
        forget('deactivation');
        if (targets.length) db.prepare('INSERT OR IGNORE INTO installation VALUES (?, ?)').run(selected, entry.id);
      })();
    } else if (enabled) {
      skipped = materialize(selected, entry, true);
      db.transaction(() => {
        forget('deactivation');
        db.prepare('INSERT OR IGNORE INTO activation VALUES (?, ?)').run(selected, entry.id);
        db.prepare('INSERT OR IGNORE INTO installation VALUES (?, ?)').run(selected, entry.id);
      })();
    } else {
      materialize(selected, entry, false);
      db.transaction(() => {
        forget('activation');
        forget('installation');
        if (state.native) db.prepare('INSERT OR IGNORE INTO deactivation VALUES (?, ?)').run(selected, entry.id);
        else forget('deactivation');
      })();
    }
    return { ok: true, enabled, skipped };
  }

  function setEnabled(workspacePath: unknown, id: string, enabled: unknown) {
    if (typeof enabled !== 'boolean') throw new Error('Activation booléenne requise.');
    const selected = workspace(workspacePath);
    const entry = document(id);
    if (entry.kind === 'skill') return setSkillEnabled(selected, entry, enabled);
    const origins = (db.prepare('SELECT source FROM origins WHERE entry_id = ?').all(id) as Array<{ source: string }>).map((row) => row.source);
    if (isPersonalComponent(entry.kind, origins)) throw new Error(NOT_TOGGLEABLE);
    return setRawEnabled(selected, entry, enabled);
  }

  function resolveWorkspace(workspacePath: unknown) {
    try { return workspace(workspacePath); } catch { return null; }
  }

  // Liens posés par la bibliothèque dans .claude, .agents et .grok du dossier : identifiant du skill → cibles présentes.
  function installedLinks(selected: string) {
    const root = path.join(directory, 'active', createHash('sha256').update(selected).digest('hex'));
    const links = new Map<string, Set<SkillTarget>>();
    for (const provider of ['.claude', '.agents', '.grok'] as const) {
      const parent = path.join(selected, provider, 'skills');
      let items: fs.Dirent[];
      try { items = fs.readdirSync(parent, { withFileTypes: true }); } catch { continue; }
      for (const item of items) {
        if (!item.isSymbolicLink()) continue;
        try {
          const target = path.resolve(parent, fs.readlinkSync(path.join(parent, item.name)));
          if (path.dirname(target) !== root || !fs.existsSync(target)) continue;
          const id = path.basename(target);
          links.set(id, (links.get(id) ?? new Set()).add(provider));
        } catch { /* lien illisible : ignoré */ }
      }
    }
    return links;
  }

  // Met les liens du dossier en accord avec l'état des skills : couverture posée pour les skills personnels
  // actifs, liens retirés pour les skills désactivés. Idempotent, sans lecture des fichiers d'un skill déjà en place.
  function reconcileWorkspace(workspacePath: string) {
    const skipped: string[] = [];
    const errors: string[] = [];
    try {
      const selected = resolveWorkspace(workspacePath);
      if (!selected) return { skipped, errors };
      const links = installedLinks(selected);
      for (const state of skillStates(selected)) {
        try {
          const present = links.get(state.id);
          if (state.enabled) {
            const targets = coverageTargets(state);
            if (!targets.some((target) => !present?.has(target))) continue;
            skipped.push(...materialize(selected, document(state.id), true, targets, true));
            db.prepare('INSERT OR IGNORE INTO installation VALUES (?, ?)').run(selected, state.id);
          } else if (present?.size) {
            materialize(selected, document(state.id), false);
            db.prepare('DELETE FROM installation WHERE workspace = ? AND entry_id = ?').run(selected, state.id);
          }
        } catch (error) { errors.push(`${state.name} : ${error instanceof Error ? error.message : String(error)}`); }
      }
    } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    return { skipped, errors };
  }

  // Skills désactivés dans le dossier (défaut ou réglage explicite) qui ont au moins une origine sur disque.
  function disabledEntries(workspacePath: string) {
    const selected = resolveWorkspace(workspacePath);
    if (!selected) return [];
    // Seuls les skills vus nativement (personnels ou du dossier) sont à masquer : un skill de la bibliothèque seule
    // désactivé n'a aucun lien dans le dossier, et le masquer par nom (Vibe) toucherait des homonymes.
    return skillStates(selected).filter((state) => !state.enabled && state.native && state.origins.length)
      .map(({ id, name, origins, claudeOrigins }) => ({ id, name, origins, claudeOrigins }));
  }

  // Skills actifs dans le dossier (défaut ou réglage explicite), avec leur contenu.
  function enabledSkills(workspacePath: string) {
    const selected = resolveWorkspace(workspacePath);
    if (!selected) return [];
    const ids = new Set(skillStates(selected).filter((state) => state.enabled).map((state) => state.id));
    return (db.prepare("SELECT id, name, content FROM entries WHERE kind = 'skill' ORDER BY name").all() as Array<{ id: string; name: string; content: string }>)
      .filter((entry) => ids.has(entry.id));
  }

  // Contenus (sans fichiers associés) des éléments demandés.
  function contents(ids: string[]) {
    const found = new Map<string, string>();
    const select = db.prepare('SELECT content FROM entries WHERE id = ?');
    for (const id of new Set(ids)) {
      const row = select.get(id) as { content: string } | undefined;
      if (row) found.set(id, row.content);
    }
    return found;
  }

  function activeWorkspaces(id: string) {
    return (db.prepare('SELECT workspace FROM activation WHERE entry_id = ? UNION SELECT workspace FROM installation WHERE entry_id = ? UNION SELECT workspace FROM deactivation WHERE entry_id = ?').all(id, id, id) as Array<{ workspace: string }>).map((row) => row.workspace);
  }

  function overrideState(selected: string) {
    const names = (db.prepare('SELECT name FROM skill_overrides WHERE workspace = ? ORDER BY name').all(selected) as Array<{ name: string }>).map((row) => row.name);
    const file = db.prepare('SELECT created FROM skill_override_files WHERE workspace = ?').get(selected) as { created: number } | undefined;
    return { names, file: file ? { created: Boolean(file.created) } : null };
  }

  function saveOverrideState(selected: string, names: string[], file: { created: boolean } | null) {
    db.transaction(() => {
      db.prepare('DELETE FROM skill_overrides WHERE workspace = ?').run(selected);
      for (const name of names) db.prepare('INSERT OR IGNORE INTO skill_overrides VALUES (?, ?)').run(selected, name);
      if (file) db.prepare('INSERT OR REPLACE INTO skill_override_files VALUES (?, ?)').run(selected, file.created ? 1 : 0);
      else db.prepare('DELETE FROM skill_override_files WHERE workspace = ?').run(selected);
    })();
  }

  function instructions(workspacePath: string, options: { includeSkills: boolean }) {
    const selected = workspace(workspacePath);
    const entries = db.prepare(`SELECT e.* FROM entries e JOIN activation a ON a.entry_id = e.id
      WHERE a.workspace = ? AND e.kind IN ('skill', 'agent') ORDER BY e.name`).all(selected) as StoredLibraryEntry[];
    const root = path.join(directory, 'active', createHash('sha256').update(selected).digest('hex'));
    const skills = options.includeSkills ? entries.filter((entry) => entry.kind === 'skill').map((entry) => {
      const assets = Object.keys(JSON.parse(entry.assets) as Record<string, string>);
      const packageRoot = path.join(root, entry.id);
      const description = entry.description.replace(/\s+/g, ' ').trim();
      const summary = description.length > 300 ? `${description.slice(0, 299).trimEnd()}…` : description;
      const files = assets.length ? ` (fichiers associés dans ${packageRoot}${assets.includes('table-columns.yaml') ? `, dont ${path.join(packageRoot, 'table-columns.yaml')}` : ''})` : '';
      return `- « ${entry.name} » — ${summary} : ${path.join(packageRoot, 'SKILL.md')}${files}`;
    }) : [];
    const agents = entries.filter((entry) => entry.kind === 'agent').map((entry) => {
      const assets = JSON.parse(entry.assets) as Record<string, string>;
      const references = Object.entries(assets).filter(([name]) => name === 'table-columns.yaml')
        .map(([name, bytes]) => `### ${name}\n${Buffer.from(bytes, 'base64').toString('utf8')}`);
      return `## Instructions de rôle : ${entry.name}\n${entry.content}\n${references.join('\n\n')}\nFichiers associés disponibles dans : ${path.join(root, entry.id)}\n${Object.keys(assets).join('\n')}`;
    });
    const index = skills.length ? `Skills disponibles pour ce dossier : avant d’appliquer un skill qui concerne la demande, lis son fichier SKILL.md avec ton outil de lecture de fichiers.\n${skills.join('\n')}` : '';
    return [index, ...agents].filter(Boolean).join('\n\n');
  }

  return {
    directory,
    userHome,
    list,
    document,
    createEntry,
    deleteEntry,
    updateDocument,
    importFile,
    importContent,
    importConnector,
    setEnabled,
    instructions,
    resolveWorkspace,
    reconcileWorkspace,
    disabledEntries,
    enabledSkills,
    contents,
    activeWorkspaces,
    overrideState,
    saveOverrideState,
    upsertCollection,
    listCollections,
    collectionFiles,
    collectionFile,
    updateCollectionFile,
    setCollectionEnabled,
    close: () => db.close(),
  };
}
