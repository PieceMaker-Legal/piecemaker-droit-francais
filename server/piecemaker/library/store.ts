import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import Database from 'better-sqlite3';

import { parseFrontMatter } from '@/shared/frontmatter.js';

import { prepareWorkspaceInstallation } from './workspace-installation.js';

type StoredLibraryEntry = {
  id: string;
  kind: 'skill' | 'agent';
  name: string;
  description: string;
  content: string;
  assets: string;
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

function collectionMainPath(entry: LibraryEntry, rootPath: string) {
  return entry.kind === 'skill' && !rootPath.toLowerCase().endsWith('.md') ? `${rootPath}/SKILL.md` : rootPath;
}

export function createLibraryStore(home: string) {
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
      source TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES entries(id)
    );
    CREATE TABLE IF NOT EXISTS activation (
      workspace TEXT NOT NULL, entry_id TEXT NOT NULL REFERENCES entries(id),
      PRIMARY KEY(workspace, entry_id)
    );
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

  function list(workspacePath?: string) {
    const selected = workspacePath ? workspace(workspacePath) : '';
    return db.prepare(`SELECT e.id, e.kind, e.name, e.description,
      EXISTS(SELECT 1 FROM activation a WHERE a.entry_id = e.id AND a.workspace = ?) AS enabled
      FROM entries e ORDER BY e.name COLLATE NOCASE`).all(selected).map((row) => {
        const entry = row as Omit<StoredLibraryEntry, 'content' | 'assets'> & { enabled: number };
        return { ...entry, enabled: Boolean(entry.enabled) };
      });
  }

  function importFile(source: string, kind: StoredLibraryEntry['kind'], includeAssets = true) {
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
    const serialized = JSON.stringify(Object.fromEntries(Object.entries(assets).sort(([a], [b]) => a.localeCompare(b))));
    const id = createHash('sha256').update(`${kind}\0${content}\0${serialized}`).digest('hex');
    db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO entries VALUES (?, ?, ?, ?, ?, ?)').run(id, kind, name, description, content, serialized);
      db.prepare('INSERT INTO origins VALUES (?, ?) ON CONFLICT(source) DO UPDATE SET entry_id = excluded.entry_id').run(path.resolve(source), id);
    })();
    return id;
  }

  function updateDocument(id: string, content: string, previousContent: string) {
    return db.transaction(() => {
      const entry = document(id);
      if (entry.content !== previousContent) throw new Error('Le document a été modifié ailleurs. Rouvrez-le avant d’enregistrer.');
      const { data } = parseFrontMatter(content);
      const name = String(data.metadata?.title || data.name || entry.name);
      const description = typeof data.description === 'string' ? data.description : '';
      db.prepare('UPDATE entries SET name = ?, description = ?, content = ? WHERE id = ?').run(name, description, content, id);
      const active = db.prepare('SELECT workspace FROM activation WHERE entry_id = ?').all(id) as Array<{ workspace: string }>;
      for (const { workspace: selected } of active) setEnabled(selected, id, true);
      return document(id);
    })();
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
      const active = db.prepare('SELECT workspace FROM activation WHERE entry_id = ?').all(id) as Array<{ workspace: string }>;
      for (const { workspace: selected } of active) setEnabled(selected, id, true);
      return { path: normalized, content };
    })();
  }

  function upsertCollection(input: LibraryCollectionInput) {
    if (!input.id || (!input.entries.length && !input.files.length)) return null;
    return db.transaction(() => {
      db.prepare(`INSERT INTO collections (id, name, description, source) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, source = excluded.source`)
        .run(input.id, input.name, input.description, input.source);
      db.prepare('DELETE FROM collection_entries WHERE collection_id = ?').run(input.id);
      const insert = db.prepare('INSERT INTO collection_entries (collection_id, entry_id, root_path) VALUES (?, ?, ?)');
      for (const entry of input.entries) insert.run(input.id, entry.entryId, normalizedCollectionPath(entry.rootPath));
      db.prepare('DELETE FROM collection_files WHERE collection_id = ?').run(input.id);
      const insertFile = db.prepare('INSERT INTO collection_files (collection_id, path, content) VALUES (?, ?, ?)');
      for (const file of input.files) insertFile.run(input.id, normalizedCollectionPath(file.path), file.content);
      return input.id;
    })();
  }

  function hasCollection(id: string) {
    return Boolean(db.prepare('SELECT 1 FROM collections WHERE id = ?').get(id));
  }

  function collectionEntries(id: string) {
    return db.prepare(`SELECT ce.entry_id AS entryId, ce.root_path AS rootPath
      FROM collection_entries ce WHERE ce.collection_id = ? ORDER BY ce.root_path COLLATE NOCASE`)
      .all(id) as LibraryCollectionEntry[];
  }

  function listCollections(workspacePath?: string) {
    const selected = workspacePath ? workspace(workspacePath) : '';
    return db.prepare(`SELECT c.id, c.name, c.description, c.source,
      COUNT(ce.entry_id) AS entryCount,
      SUM(CASE WHEN a.entry_id IS NOT NULL THEN 1 ELSE 0 END) AS enabledCount
      FROM collections c
      LEFT JOIN collection_entries ce ON ce.collection_id = c.id
      LEFT JOIN activation a ON a.entry_id = ce.entry_id AND a.workspace = ?
      GROUP BY c.id ORDER BY c.name COLLATE NOCASE`).all(selected).map((row) => {
        const collection = row as { id: string; name: string; description: string; source: string; entryCount: number; enabledCount: number };
        return {
          id: collection.id,
          name: collection.name,
          description: collection.description,
          source: collection.source,
          enabled: collection.entryCount > 0 && collection.enabledCount === collection.entryCount,
          partial: collection.enabledCount > 0 && collection.enabledCount < collection.entryCount,
          componentCount: collection.entryCount,
        };
      });
  }

  function collectionFiles(id: string) {
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
    const active = new Set((db.prepare('SELECT entry_id AS entryId FROM activation WHERE workspace = ?').all(selected) as Array<{ entryId: string }>).map((entry) => entry.entryId));
    const changed: string[] = [];
    try {
      for (const mapping of mappings) {
        if (active.has(mapping.entryId) === enabled) continue;
        setEnabled(selected, mapping.entryId, enabled);
        changed.push(mapping.entryId);
      }
    } catch (error) {
      for (const entryId of changed.reverse()) setEnabled(selected, entryId, !enabled);
      throw error;
    }
    return listCollections(selected).find((collection) => collection.id === id);
  }

  function setEnabled(workspacePath: unknown, id: string, enabled: unknown) {
    if (typeof enabled !== 'boolean') throw new Error('Activation booléenne requise.');
    const selected = workspace(workspacePath);
    const entry = document(id);
    const packageRoot = path.join(directory, 'active', createHash('sha256').update(selected).digest('hex'), id);
    const install = prepareWorkspaceInstallation(selected, id, packageRoot, entry.kind, enabled);
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
          const toml = Object.entries({ name: String(data.name || `piecemaker-${id}`), description: entry.description || entry.name, developer_instructions: content })
            .map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n');
          fs.writeFileSync(path.join(staging, 'agent.toml'), `${toml}\n`, { mode: 0o600 });
        }
        if (fs.existsSync(packageRoot)) fs.renameSync(packageRoot, backup);
        try {
          fs.renameSync(staging, packageRoot);
          install();
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
      install();
      fs.rmSync(packageRoot, { recursive: true, force: true });
    } else {
      install();
    }
    if (enabled) db.prepare('INSERT OR IGNORE INTO activation VALUES (?, ?)').run(selected, id);
    else db.prepare('DELETE FROM activation WHERE workspace = ? AND entry_id = ?').run(selected, id);
    return { ok: true, enabled };
  }

  function instructions(workspacePath: string) {
    const selected = workspace(workspacePath);
    const entries = db.prepare(`SELECT e.* FROM entries e JOIN activation a ON a.entry_id = e.id
      WHERE a.workspace = ? ORDER BY e.name`).all(selected) as StoredLibraryEntry[];
    return entries.map((entry) => {
      const assets = JSON.parse(entry.assets) as Record<string, string>;
      const references = Object.entries(assets).filter(([name]) => name === 'table-columns.yaml')
        .map(([name, bytes]) => `### ${name}\n${Buffer.from(bytes, 'base64').toString('utf8')}`);
      const packageRoot = path.join(directory, 'active', createHash('sha256').update(selected).digest('hex'), entry.id);
      return `## ${entry.kind === 'agent' ? 'Instructions de rôle' : 'Skill'} : ${entry.name}\n${entry.content}\n${references.join('\n\n')}\nFichiers associés disponibles dans : ${packageRoot}\n${Object.keys(assets).join('\n')}`;
    }).join('\n\n');
  }

  return {
    directory,
    list,
    document,
    updateDocument,
    importFile,
    setEnabled,
    instructions,
    upsertCollection,
    hasCollection,
    listCollections,
    collectionFiles,
    collectionFile,
    updateCollectionFile,
    setCollectionEnabled,
    close: () => db.close(),
  };
}
