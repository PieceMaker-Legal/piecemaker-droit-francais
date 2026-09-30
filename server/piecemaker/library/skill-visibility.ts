import fs from 'node:fs';
import path from 'node:path';

import type { providerSkillsService } from '@/modules/providers/index.js';
import { parseFrontMatter } from '@/shared/frontmatter.js';
import type { ProviderSkill } from '@/shared/types.js';

import type { createLibraryStore } from './store.js';
import { componentFolderName, updateGitExclude } from './workspace-installation.js';

type Store = ReturnType<typeof createLibraryStore>;

const SETTINGS_EXCLUDE = '/.claude/settings.local.json';

function realpath(file: string) {
  try { return fs.realpathSync(file); } catch { return null; }
}

// Dans un dossier géré, sépare les skills personnels connus de la bibliothèque mais non activés (masqués) des autres.
export function splitLibraryHiddenSkills(skills: ProviderSkill[], store: Store, workspacePath: string | undefined): { visible: ProviderSkill[]; hidden: ProviderSkill[] } {
  if (!workspacePath || !store.isManagedWorkspace(workspacePath)) return { visible: skills, hidden: [] };
  const active = store.activeEntryIds(workspacePath);
  const visible: ProviderSkill[] = [];
  const hidden: ProviderSkill[] = [];
  for (const skill of skills) {
    let isHidden = false;
    if (skill.scope === 'user' && !skill.pluginId && !skill.pluginName && skill.sourcePath) {
      const source = realpath(skill.sourcePath);
      const entryId = source ? store.originEntryId(source) : null;
      isHidden = Boolean(entryId) && !active.has(entryId as string);
    }
    (isHidden ? hidden : visible).push(skill);
  }
  return { visible, hidden };
}

// Filtre le popup : dans un dossier géré, seuls les skills personnels activés pour lui restent visibles.
// Retourne le listage d'origine (non filtré), pour calculer les skills masqués côté runtime.
export function installLibrarySkillVisibility(service: Pick<typeof providerSkillsService, 'listProviderSkills'>, store: Store) {
  const list = service.listProviderSkills.bind(service);
  service.listProviderSkills = async (provider, options) => {
    const skills = await list(provider, options);
    try {
      return splitLibraryHiddenSkills(skills, store, options?.workspacePath).visible;
    } catch { return skills; }
  };
  return list;
}

type PersonalClaudeSkill = { name: string; file: string; realFile: string; content: string };

// Skills personnels de Claude Code : ~/.claude/skills/*/SKILL.md et ~/.claude/skills/synced/*/SKILL.md
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
        found.push({ name: typeof name === 'string' && name.trim() ? name.trim() : child.name, file, realFile, content });
      } catch { /* skill illisible ou dossier sans SKILL.md */ }
    }
  };
  scan(root, true);
  scan(path.join(root, 'synced'), false);
  return found;
}

export function installedNames(store: Store, workspacePath: string) {
  const names = new Set<string>();
  for (const entry of store.activeSkills(workspacePath)) {
    names.add(entry.name.toLowerCase());
    try {
      const { data } = parseFrontMatter(entry.content);
      if (typeof data.name === 'string') names.add(data.name.trim().toLowerCase());
      names.add(componentFolderName(String(data.name || data.metadata?.title || entry.name)));
    } catch { /* nom déjà couvert par le nom de l'entrée */ }
  }
  return names;
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

// Masque dans Claude Code (skillOverrides) les skills personnels non activés dans un dossier géré.
export function applyWorkspaceSkillVisibility(store: Store, workspacePath: string, userHome: string): { off: string[]; error?: string } {
  let tracked: string[] = [];
  try {
    const workspace = store.resolveWorkspace(workspacePath);
    if (!workspace) return { off: [] };
    const state = store.overrideState(workspace);
    tracked = state.names;
    const desired = new Map<string, string>();
    if (store.isManagedWorkspace(workspace)) {
      const active = store.activeEntryIds(workspace);
      const installed = installedNames(store, workspace);
      for (const skill of personalClaudeSkills(userHome)) {
        const entryId = store.originEntryId(skill.realFile);
        const key = skill.name.toLowerCase();
        if (entryId && !active.has(entryId) && !installed.has(key) && !desired.has(key)) desired.set(key, skill.name);
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
      if ([...nextTracked].some((tracked) => tracked.toLowerCase() === lower) || keyFor(lower) !== undefined) continue;
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
    const managed = tracking.length > 0;
    const fileExists = fs.existsSync(filename);
    store.saveOverrideState(workspace, tracking, managed && fileExists ? { created } : null);
    if (managed && fileExists) updateGitExclude(workspace, [SETTINGS_EXCLUDE], []);
    else updateGitExclude(workspace, [], [SETTINGS_EXCLUDE]);
    return { off: tracking };
  } catch (error) {
    return { off: tracked, error: error instanceof Error ? error.message : String(error) };
  }
}
