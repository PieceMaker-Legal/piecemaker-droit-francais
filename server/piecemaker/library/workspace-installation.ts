import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const SKILL_LINK_PROVIDERS = ['.claude', '.cursor', '.opencode', '.grok'];

const AGENT_TARGETS = [
  { provider: '.claude', folder: 'agents', extension: '.md' },
  { provider: '.codex', folder: 'agents', extension: '.toml' },
  { provider: '.opencode', folder: 'agent', extension: '.md' },
  { provider: '.grok', folder: 'agents', extension: '.md' },
] as const;

const MANIFEST_PATH = '.piecemaker/library.json';

export type LibraryManifestEntry = {
  id: string;
  kind: 'skill' | 'agent' | 'connector';
  name: string;
  slug: string;
  files: Record<string, string>;
  skipClaude: boolean;
};

export type LibraryComponent =
  | { kind: 'skill'; slug: string; files: Record<string, Buffer> }
  | { kind: 'agent'; slug: string; markdown: string; toml: string };

export function componentFolderName(name: string) {
  const slug = String(name).normalize('NFKD').replace(/[^\p{Letter}\p{Number}._-]+/gu, '-').replace(/^[-._]+|[-._]+$/g, '');
  if (!slug) throw new Error(`Nom de composant inutilisable : ${name}`);
  return slug;
}

function digest(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertWorkspaceParents(workspace: string, relative: string, create: boolean) {
  let directory = workspace;
  for (const segment of path.posix.dirname(relative).split('/')) {
    directory = path.join(directory, segment);
    if (!fs.existsSync(directory)) {
      if (!create) return;
      fs.mkdirSync(directory);
    } else if (!fs.statSync(directory).isDirectory() || !fs.realpathSync(directory).startsWith(workspace + path.sep)) {
      throw new Error(`Répertoire de composants hors du dossier : ${directory}`);
    }
  }
}

export function readLibraryManifest(workspace: string): LibraryManifestEntry[] | null {
  const filename = path.join(workspace, MANIFEST_PATH);
  if (!fs.existsSync(filename)) return null;
  try {
    const entries = JSON.parse(fs.readFileSync(filename, 'utf8')).entries;
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

export function writeLibraryManifest(workspace: string, entries: LibraryManifestEntry[]) {
  assertWorkspaceParents(workspace, MANIFEST_PATH, true);
  const filename = path.join(workspace, MANIFEST_PATH);
  const temporary = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`);
  fs.renameSync(temporary, filename);
}

function skillRoot(slug: string) {
  return path.posix.join('.agents', 'skills', slug);
}

function componentShape(kind: LibraryManifestEntry['kind'], slug: string, skipClaude: boolean) {
  if (kind !== 'skill') return { root: null, links: [] as string[] };
  return {
    root: skillRoot(slug),
    links: SKILL_LINK_PROVIDERS.filter((provider) => !(skipClaude && provider === '.claude')).map((provider) => path.posix.join(provider, 'skills', slug)),
  };
}

function componentFiles(workspace: string, component: LibraryComponent, skipClaude: boolean) {
  if (component.kind === 'agent') {
    return Object.fromEntries(AGENT_TARGETS.filter((target) => !(skipClaude && target.provider === '.claude')).map((target) => [
      path.posix.join(target.provider, target.folder, `${component.slug}${target.extension}`),
      Buffer.from(target.extension === '.toml' ? component.toml : component.markdown, 'utf8'),
    ]));
  }
  const root = skillRoot(component.slug);
  return Object.fromEntries(Object.entries(component.files).map(([name, bytes]) => {
    const relative = path.posix.join(root, name);
    if (!path.resolve(workspace, relative).startsWith(path.join(workspace, root) + path.sep)) throw new Error('Chemin associé invalide.');
    return [relative, bytes];
  }));
}

export function componentFileHashes(workspace: string, component: LibraryComponent, skipClaude: boolean) {
  return Object.fromEntries(Object.entries(componentFiles(workspace, component, skipClaude)).map(([relative, bytes]) => [relative, digest(bytes)]));
}

function walkFiles(workspace: string, relative: string, visit: (relative: string) => void) {
  for (const child of fs.readdirSync(path.join(workspace, relative), { withFileTypes: true })) {
    const childPath = path.posix.join(relative, child.name);
    if (child.isDirectory()) walkFiles(workspace, childPath, visit);
    else visit(childPath);
  }
}

export function removeLegacyLinks(workspace: string, legacyDirectory: string) {
  for (const provider of ['.agents', ...SKILL_LINK_PROVIDERS]) {
    const parent = path.join(workspace, provider, 'skills');
    if (!fs.existsSync(parent) || !fs.realpathSync(parent).startsWith(workspace + path.sep)) continue;
    for (const child of fs.readdirSync(parent, { withFileTypes: true })) {
      if (!child.isSymbolicLink()) continue;
      const link = path.join(parent, child.name);
      if (path.resolve(parent, fs.readlinkSync(link)).startsWith(legacyDirectory + path.sep)) fs.unlinkSync(link);
    }
  }
}

export function prepareWorkspaceInstallation(
  workspace: string,
  previous: LibraryManifestEntry | undefined,
  next: { component: LibraryComponent; skipClaude: boolean } | null,
) {
  const before = previous ? componentShape(previous.kind, previous.slug, previous.skipClaude) : null;
  const after = next ? componentShape(next.component.kind, next.component.slug, next.skipClaude) : null;
  const nextFiles = next ? componentFiles(workspace, next.component, next.skipClaude) : {};
  const owned = previous?.files ?? {};

  for (const relative of [...Object.keys(nextFiles), ...(after?.links ?? [])]) assertWorkspaceParents(workspace, relative, true);
  for (const relative of [...Object.keys(owned), ...(before?.links ?? [])]) assertWorkspaceParents(workspace, relative, false);

  const snapshots = new Map<string, Buffer>();
  const inspect = (relative: string) => {
    const absolute = path.join(workspace, relative);
    let existing: fs.Stats;
    try { existing = fs.lstatSync(absolute); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    const bytes = existing.isFile() ? fs.readFileSync(absolute) : null;
    if (!bytes || owned[relative] !== digest(bytes)) throw new Error(`Composant personnel préservé : ${absolute}`);
    snapshots.set(relative, bytes);
  };
  for (const relative of new Set([...Object.keys(owned), ...Object.keys(nextFiles)])) inspect(relative);
  for (const root of new Set([before?.root, after?.root])) {
    if (!root || !fs.existsSync(path.join(workspace, root))) continue;
    if (!fs.lstatSync(path.join(workspace, root)).isDirectory()) throw new Error(`Composant personnel préservé : ${path.join(workspace, root)}`);
    walkFiles(workspace, root, inspect);
  }

  const existingLinks = new Map<string, string>();
  for (const shape of [before, after]) {
    for (const link of shape?.links ?? []) {
      const absolute = path.join(workspace, link);
      let existing: fs.Stats;
      try { existing = fs.lstatSync(absolute); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      const target = path.join(workspace, shape!.root!);
      if (!existing.isSymbolicLink() || path.resolve(path.dirname(absolute), fs.readlinkSync(absolute)) !== target) {
        throw new Error(`Composant personnel préservé : ${absolute}`);
      }
      existingLinks.set(link, target);
    }
  }

  const link = (relative: string, target: string) => {
    const absolute = path.join(workspace, relative);
    if (process.platform === 'win32') fs.symlinkSync(target, absolute, 'junction');
    else fs.symlinkSync(path.relative(path.dirname(absolute), target), absolute, 'dir');
  };
  const clear = (links: Iterable<string>, files: Iterable<string>, root: string | null | undefined) => {
    for (const relative of links) fs.rmSync(path.join(workspace, relative), { force: true });
    for (const relative of files) fs.rmSync(path.join(workspace, relative), { force: true });
    if (root) fs.rmSync(path.join(workspace, root), { recursive: true, force: true });
  };

  return {
    files: Object.fromEntries(Object.entries(nextFiles).map(([relative, bytes]) => [relative, digest(bytes)])),
    commit() {
      try {
        clear(existingLinks.keys(), snapshots.keys(), before?.root);
        for (const [relative, bytes] of Object.entries(nextFiles)) {
          fs.mkdirSync(path.dirname(path.join(workspace, relative)), { recursive: true });
          fs.writeFileSync(path.join(workspace, relative), bytes);
        }
        for (const relative of after?.links ?? []) link(relative, path.join(workspace, after!.root!));
      } catch (error) {
        clear(after?.links ?? [], Object.keys(nextFiles), after?.root);
        for (const [relative, bytes] of snapshots) {
          fs.mkdirSync(path.dirname(path.join(workspace, relative)), { recursive: true });
          fs.writeFileSync(path.join(workspace, relative), bytes);
        }
        for (const [relative, target] of existingLinks) link(relative, target);
        throw error;
      }
    },
  };
}
