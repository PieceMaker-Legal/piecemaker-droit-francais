import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SKILL_PROVIDERS = ['.claude', '.agents', '.grok'];
const LEGACY_SKILL_PROVIDERS = ['.cursor', '.opencode'];

const AGENT_TARGETS = [
  { provider: '.claude', folder: 'agents', extension: '.md', sourceFile: 'agent.md' },
  { provider: '.codex', folder: 'agents', extension: '.toml', sourceFile: 'agent.toml' },
  { provider: '.opencode', folder: 'agent', extension: '.md', sourceFile: 'agent.md' },
  { provider: '.grok', folder: 'agents', extension: '.md', sourceFile: 'agent.md' },
] as const;

const GIT_EXCLUDE_BEGIN = '# PieceMaker Bibliothèque (début)';
const GIT_EXCLUDE_END = '# PieceMaker Bibliothèque (fin)';

const LIGATURES: Record<string, string> = { œ: 'oe', æ: 'ae', ß: 'ss', ø: 'o', đ: 'd', ł: 'l' };

export function componentFolderName(name: string) {
  const text = String(name);
  if (!text.trim()) throw new Error(`Nom de composant inutilisable : ${name}`);
  const slug = text.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
    .replace(/[œæßøđł]/g, (letter) => LIGATURES[letter])
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '');
  // Un nom sans lettre latine (ex. chinois) garde un dossier stable conforme à la spec.
  return slug || `composant-${createHash('sha256').update(text).digest('hex').slice(0, 12)}`;
}

function legacyComponentFolderName(name: string) {
  return String(name).normalize('NFKD').replace(/[^\p{Letter}\p{Number}._-]+/gu, '-').replace(/^[-._]+|[-._]+$/g, '');
}

function assertWorkspaceDirectory(workspace: string, directory: string, enabled: boolean) {
  if (!fs.existsSync(directory)) {
    if (enabled) fs.mkdirSync(directory);
    return;
  }
  if (!fs.statSync(directory).isDirectory() || !fs.realpathSync(directory).startsWith(workspace + path.sep)) {
    throw new Error(`Répertoire de composants hors du dossier : ${directory}`);
  }
}

function relativeExcludePath(workspace: string, target: string) {
  return `/${path.relative(workspace, target).split(path.sep).join('/')}`;
}

// Maintient le bloc géré dans .git/info/exclude ; sans effet si .git n'est pas un dossier.
export function updateGitExclude(workspace: string, add: string[], remove: string[]) {
  try {
    const gitDirectory = path.join(workspace, '.git');
    if (!fs.lstatSync(gitDirectory).isDirectory()) return;
    const file = path.join(gitDirectory, 'info', 'exclude');
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const lines = text.split('\n');
    const begin = lines.findIndex((line) => line.trimEnd() === GIT_EXCLUDE_BEGIN);
    let blockEnd = begin;
    let current: string[] = [];
    if (begin !== -1) {
      const end = lines.findIndex((line, index) => index > begin && line.trimEnd() === GIT_EXCLUDE_END);
      blockEnd = end !== -1 ? end : begin;
      if (end === -1) while (lines[blockEnd + 1]?.startsWith('/')) blockEnd += 1;
      current = lines.slice(begin + 1, end !== -1 ? end : blockEnd + 1).map((line) => line.trimEnd()).filter(Boolean);
    }
    const dropped = new Set(remove);
    const next = current.filter((line) => !dropped.has(line));
    for (const line of add) if (!next.includes(line)) next.push(line);
    if (next.length === current.length && next.every((line, index) => line === current[index])) return;
    const block = next.length ? [GIT_EXCLUDE_BEGIN, ...next, GIT_EXCLUDE_END] : [];
    let result: string[];
    if (begin !== -1) result = [...lines.slice(0, begin), ...block, ...lines.slice(blockEnd + 1)];
    else {
      const outside = lines.at(-1) === '' ? lines.slice(0, -1) : lines;
      result = [...outside, ...block, ''];
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, result.join('\n'));
      fs.renameSync(temporary, file);
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      throw error;
    }
  } catch { /* l'exclusion git ne doit jamais faire échouer l'activation */ }
}

function ownedLink(link: string, source: string) {
  try {
    if (!fs.lstatSync(link).isSymbolicLink()) return false;
    if (path.resolve(path.dirname(link), fs.readlinkSync(link)) === source) return true;
    return fs.existsSync(source) && fs.realpathSync(link) === fs.realpathSync(source);
  } catch { return false; }
}

function removeOwnedLegacy(legacy: string, source: string, kind: 'skill' | 'agent') {
  let existing: fs.Stats;
  try { existing = fs.lstatSync(legacy); } catch { return; }
  const owned = kind === 'skill'
    ? existing.isSymbolicLink() && ownedLink(legacy, source)
    : existing.isFile() && fs.existsSync(source) && fs.readFileSync(legacy).equals(fs.readFileSync(source));
  if (owned) fs.unlinkSync(legacy);
}

export function prepareWorkspaceInstallation(workspace: string, id: string, name: string, packageRoot: string, kind: 'skill' | 'agent', enabled: boolean) {
  const slug = componentFolderName(name);
  let legacySlug = '';
  try { legacySlug = legacyComponentFolderName(name); } catch { /* nom sans ancien équivalent */ }
  if (legacySlug === slug) legacySlug = '';
  const legacyNames = (extension = '') => [`piecemaker-${id}${extension}`, ...(legacySlug ? [`${legacySlug}${extension}`] : [])];
  const targets = kind === 'skill'
    ? SKILL_PROVIDERS.map((provider) => {
      const parent = path.join(workspace, provider, 'skills');
      for (const directory of [path.dirname(parent), parent]) assertWorkspaceDirectory(workspace, directory, enabled);
      return {
        parent,
        target: path.join(parent, slug),
        legacy: legacyNames().map((legacyName) => path.join(parent, legacyName)),
        source: packageRoot,
        kind: 'skill' as const,
      };
    })
    : AGENT_TARGETS.map((entry) => {
      const parent = path.join(workspace, entry.provider, entry.folder);
      for (const directory of [path.dirname(parent), parent]) assertWorkspaceDirectory(workspace, directory, enabled);
      return {
        parent,
        target: path.join(parent, `${slug}${entry.extension}`),
        legacy: legacyNames(entry.extension).map((legacyName) => path.join(parent, legacyName)),
        source: path.join(packageRoot, entry.sourceFile),
        kind: 'agent' as const,
      };
    });
  const obsolete = kind === 'skill'
    ? LEGACY_SKILL_PROVIDERS.flatMap((provider) => [slug, ...legacyNames()].map((legacyName) => path.join(workspace, provider, 'skills', legacyName)))
    : [];

  const prepared = targets.map((entry) => {
    let existing: fs.Stats;
    try { existing = fs.lstatSync(entry.target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...entry, installed: false, content: null, skipped: false };
      throw error;
    }
    const content = entry.kind === 'agent' && existing.isFile() ? fs.readFileSync(entry.target) : null;
    const owned = entry.kind === 'skill'
      ? existing.isSymbolicLink() && path.resolve(entry.parent, fs.readlinkSync(entry.target)) === entry.source
      : content && fs.existsSync(entry.source) && content.equals(fs.readFileSync(entry.source));
    if (!owned) return { ...entry, installed: false, content: null, skipped: true };
    return { ...entry, installed: true, content, skipped: false };
  });
  if (enabled && prepared.every((entry) => entry.skipped)) throw new Error(`Composant personnel préservé : ${prepared[0].target}`);

  return () => {
    const changed: typeof prepared = [];
    try {
      for (const entry of prepared) {
        const { target, source, installed, kind: targetKind, skipped } = entry;
        if (skipped) continue;
        if (enabled && targetKind === 'agent') {
          fs.copyFileSync(source, target);
          changed.push(entry);
        } else if (enabled && !installed) {
          fs.symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
          changed.push(entry);
        } else if (!enabled && installed) {
          fs.unlinkSync(target);
          changed.push(entry);
        }
      }
    } catch (error) {
      for (const { target, source, content, installed } of changed.reverse()) {
        if (content) fs.writeFileSync(target, content);
        else if (!installed) fs.unlinkSync(target);
        else fs.symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
      }
      throw error;
    }
    for (const { legacy, source, kind: targetKind } of prepared) {
      for (const legacyPath of legacy) removeOwnedLegacy(legacyPath, source, targetKind);
    }
    for (const legacyPath of obsolete) removeOwnedLegacy(legacyPath, packageRoot, 'skill');
    const active = prepared.filter((entry) => !entry.skipped).map((entry) => relativeExcludePath(workspace, entry.target));
    const skippedPaths = prepared.filter((entry) => entry.skipped).map((entry) => relativeExcludePath(workspace, entry.target));
    if (enabled) updateGitExclude(workspace, active, skippedPaths);
    else updateGitExclude(workspace, [], [...active, ...skippedPaths]);
    return { skipped: enabled ? prepared.filter((entry) => entry.skipped).map((entry) => entry.target) : [] };
  };
}
