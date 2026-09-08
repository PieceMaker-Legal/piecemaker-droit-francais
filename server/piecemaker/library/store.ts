import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import Database from 'better-sqlite3';

import { parseFrontMatter } from '@/shared/frontmatter.js';

import { prepareWorkspaceInstallation } from './workspace-installation.js';

type LibraryEntry = {
  id: string;
  kind: 'skill' | 'agent';
  name: string;
  description: string;
  content: string;
  assets: string;
};

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
  `);

  function workspace(value: unknown) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Dossier absolu requis.');
    const resolved = fs.realpathSync(value);
    if (!fs.statSync(resolved).isDirectory()) throw new Error('Dossier introuvable.');
    return resolved;
  }

  function document(id: string) {
    const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as LibraryEntry | undefined;
    if (!entry) throw new Error('Élément introuvable.');
    return { ...entry, assets: JSON.parse(entry.assets) as Record<string, string> };
  }

  function list(workspacePath?: string) {
    const selected = workspacePath ? workspace(workspacePath) : '';
    return db.prepare(`SELECT e.id, e.kind, e.name, e.description,
      EXISTS(SELECT 1 FROM activation a WHERE a.entry_id = e.id AND a.workspace = ?) AS enabled
      FROM entries e ORDER BY e.name COLLATE NOCASE`).all(selected).map((row) => {
        const entry = row as Omit<LibraryEntry, 'content' | 'assets'> & { enabled: number };
        return { ...entry, enabled: Boolean(entry.enabled) };
      });
  }

  function importFile(source: string, kind: LibraryEntry['kind'], includeAssets = true) {
    const resolved = fs.realpathSync(source);
    const content = fs.readFileSync(resolved, 'utf8');
    const parsed = parseFrontMatter(content);
    const data = parsed.data;
    const name = String(data.metadata?.title || data.name || path.basename(path.dirname(source)));
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
      WHERE a.workspace = ? ORDER BY e.name`).all(selected) as LibraryEntry[];
    return entries.map((entry) => {
      const assets = JSON.parse(entry.assets) as Record<string, string>;
      const references = Object.entries(assets).filter(([name]) => name === 'table-columns.yaml')
        .map(([name, bytes]) => `### ${name}\n${Buffer.from(bytes, 'base64').toString('utf8')}`);
      const packageRoot = path.join(directory, 'active', createHash('sha256').update(selected).digest('hex'), entry.id);
      return `## ${entry.kind === 'agent' ? 'Instructions de rôle' : 'Skill'} : ${entry.name}\n${entry.content}\n${references.join('\n\n')}\nFichiers associés disponibles dans : ${packageRoot}\n${Object.keys(assets).join('\n')}`;
    }).join('\n\n');
  }

  return { directory, list, document, updateDocument, importFile, setEnabled, instructions, close: () => db.close() };
}
