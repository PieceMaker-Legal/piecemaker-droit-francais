import fs from 'node:fs';
import path from 'node:path';

import type { providerSkillsService } from '@/modules/providers/index.js';
import { parseFrontMatter } from '@/shared/frontmatter.js';
import type { ProviderSkill } from '@/shared/types.js';

import type { createLibraryStore } from './store.js';
import { componentFolderName } from './workspace-installation.js';

type Store = ReturnType<typeof createLibraryStore>;

function realpath(file: string) {
  try { return fs.realpathSync(file); } catch { return null; }
}

export function visibleLibrarySkills(skills: ProviderSkill[], store: Store, workspacePath: string | undefined) {
  if (!workspacePath) return skills;
  const disabled = new Set(store.disabledEntries(workspacePath).flatMap((entry) => entry.origins));
  if (!disabled.size) return skills;
  return skills.filter((skill) => {
    const source = !skill.pluginId && !skill.pluginName && skill.sourcePath ? realpath(skill.sourcePath) : null;
    return !source || !disabled.has(source);
  });
}

export function installLibrarySkillVisibility(service: Pick<typeof providerSkillsService, 'listProviderSkills'>, store: Store) {
  const list = service.listProviderSkills.bind(service);
  service.listProviderSkills = async (provider, options) => {
    const workspacePath = options?.workspacePath;
    if (workspacePath) {
      try {
        store.reconcileWorkspace(workspacePath);
        applyWorkspaceSkillVisibility(store, workspacePath);
      } catch {}
    }
    const skills = await list(provider, options);
    try { return visibleLibrarySkills(skills, store, workspacePath); }
    catch { return skills; }
  };
}

type PersonalClaudeSkill = { name: string; file: string; content: string };

export function personalClaudeSkills(userHome: string): PersonalClaudeSkill[] {
  const root = path.join(userHome, '.claude', 'skills');
  const found: PersonalClaudeSkill[] = [];
  const scan = (directory: string, skipSynced: boolean) => {
    let children: fs.Dirent[];
    try { children = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const child of children) {
      if (child.name.startsWith('.') || (skipSynced && child.name === 'synced')) continue;
      const file = path.join(directory, child.name, 'SKILL.md');
      try {
        const realFile = fs.realpathSync(file);
        if (!fs.statSync(realFile).isFile()) continue;
        const content = fs.readFileSync(realFile, 'utf8');
        const name = parseFrontMatter(content).data.name;
        found.push({ name: typeof name === 'string' && name.trim() ? name.trim() : child.name, file, content });
      } catch {}
    }
  };
  scan(root, true);
  scan(path.join(root, 'synced'), false);
  return found;
}

export function installedNames(store: Store, workspacePath: string) {
  const names = new Set<string>();
  for (const entry of store.enabledSkills(workspacePath)) {
    names.add(entry.name.toLowerCase());
    try {
      const { data } = parseFrontMatter(entry.content);
      if (typeof data.name === 'string') names.add(data.name.trim().toLowerCase());
      names.add(componentFolderName(String(data.name || data.metadata?.title || entry.name)));
    } catch {}
  }
  return names;
}

export function disabledSkillName(content: string | undefined, origin: string) {
  let name: unknown;
  try { name = content === undefined ? undefined : parseFrontMatter(content).data.name; } catch {}
  if (typeof name === 'string' && name.trim()) return name.trim();
  return path.basename(origin).toLowerCase() === 'skill.md' ? path.basename(path.dirname(origin)) : path.basename(origin, path.extname(origin));
}

function assertClaudeDirectory(workspace: string) {
  const directory = path.join(workspace, '.claude');
  let stat: fs.Stats;
  try { stat = fs.lstatSync(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return directory; throw error; }
  if (!fs.statSync(directory).isDirectory() || (stat.isSymbolicLink() && !fs.realpathSync(directory).startsWith(workspace + path.sep))) {
    throw new Error(`Répertoire .claude hors du dossier : ${directory}`);
  }
  return directory;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function applyWorkspaceSkillVisibility(store: Store, workspacePath: string): { off: string[]; error?: string } {
  let tracked: string[] = [];
  try {
    const workspace = store.resolveWorkspace(workspacePath);
    if (!workspace) return { off: [] };
    const state = store.overrideState(workspace);
    tracked = state.names;
    const desired = new Map<string, string>();
    const candidates = store.disabledEntries(workspace).filter((entry) => entry.claudeOrigins.length);
    if (candidates.length) {
      const contents = store.contents(candidates.map((entry) => entry.id));
      const installed = installedNames(store, workspace);
      for (const entry of candidates) {
        const name = disabledSkillName(contents.get(entry.id), entry.claudeOrigins[0]);
        const key = name.toLowerCase();
        if (!installed.has(key) && !desired.has(key)) desired.set(key, name);
      }
    }
    if (!desired.size && !state.names.length) return { off: [] };

    const claudeDirectory = assertClaudeDirectory(workspace);
    const filename = path.join(claudeDirectory, 'settings.local.json');
    let settings: Record<string, unknown> = {};
    let existed = false;
    try {
      if (fs.lstatSync(filename).isSymbolicLink()) throw new Error(`Fichier de réglages lié, non modifié : ${filename}`);
      const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (!isPlainObject(parsed)) throw new Error('not-object');
      settings = parsed;
      existed = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        const message = (error as Error).message;
        throw new Error(message.startsWith('Fichier de réglages') ? message : `Réglages Claude invalides, non modifiés : ${filename}`);
      }
    }
    const current = settings.skillOverrides;
    if (current !== undefined && !isPlainObject(current)) throw new Error(`skillOverrides invalide, non modifié : ${filename}`);
    const overrides: Record<string, unknown> = { ...(current as Record<string, unknown> | undefined) };
    const keyFor = (name: string) => Object.keys(overrides).find((key) => key.toLowerCase() === name.toLowerCase());

    const nextTracked = new Set<string>();
    for (const name of state.names) {
      const key = keyFor(name);
      if (key === undefined || overrides[key] !== 'off') continue;
      if (desired.has(name.toLowerCase())) nextTracked.add(name);
      else delete overrides[key];
    }
    for (const [lower, name] of desired) {
      if ([...nextTracked].some((item) => item.toLowerCase() === lower) || keyFor(lower) !== undefined) continue;
      overrides[name] = 'off';
      nextTracked.add(name);
    }

    const next = { ...settings };
    if (Object.keys(overrides).length) next.skillOverrides = overrides;
    else delete next.skillOverrides;
    const created = existed ? state.file?.created ?? false : true;
    const empty = Object.keys(next).length === 0;
    if (empty && created) fs.rmSync(filename, { force: true });
    else if (existed ? JSON.stringify(next) !== JSON.stringify(settings) : !empty) {
      fs.mkdirSync(claudeDirectory, { recursive: true });
      const temporary = `${filename}.${process.pid}.tmp`;
      try {
        fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`);
        fs.renameSync(temporary, filename);
      } catch (error) { fs.rmSync(temporary, { force: true }); throw error; }
    }
    const tracking = [...nextTracked].sort();
    store.saveOverrideState(workspace, tracking, tracking.length && fs.existsSync(filename) ? { created } : null);
    return { off: tracking };
  } catch (error) {
    return { off: tracked, error: error instanceof Error ? error.message : String(error) };
  }
}
