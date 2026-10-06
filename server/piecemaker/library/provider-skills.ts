import fs from 'node:fs';
import path from 'node:path';

import { providerSkillsService } from '@/modules/providers/index.js';
import type { LLMProvider, ProviderSkillListOptions } from '@/shared/types.js';

import { importLibraryDirectory } from './migrate.js';
import { recordScanError, type LibraryScanError } from './scan-errors.js';
import type { createLibraryStore } from './store.js';
import { readLibraryManifest, skillRoot } from './workspace-installation.js';

type LibraryStore = ReturnType<typeof createLibraryStore>;

const LIBRARY_SKILL_PROVIDERS: LLMProvider[] = ['claude', 'codex', 'cursor', 'mistral', 'opencode'];

export type ProviderSkillsReader = {
  listProviderSkills(provider: string, options?: ProviderSkillListOptions): ReturnType<typeof providerSkillsService.listProviderSkills>;
};

export async function listLibraryProviderSkills(
  workspacePath: string | undefined,
  reader: ProviderSkillsReader,
) {
  const results = await Promise.all(LIBRARY_SKILL_PROVIDERS.map(async (provider) => {
    try {
      return {
        provider,
        skills: await reader.listProviderSkills(provider, { workspacePath }),
      };
    } catch (error) {
      return {
        provider,
        skills: [],
        error: error instanceof Error ? error.message : 'Chargement impossible.',
      };
    }
  }));

  return { providers: results };
}

function importSkillFile(store: LibraryStore, sourcePath: string, errors?: LibraryScanError[]) {
  try { store.importFile(sourcePath, 'skill'); }
  catch {
    try { store.importFile(sourcePath, 'skill', false); }
    catch (error) { recordScanError(errors, sourcePath, error); }
  }
}

function importPersonalClaudeCommands(store: LibraryStore, directory: string, errors?: LibraryScanError[]) {
  let items: fs.Dirent[];
  try {
    if (fs.lstatSync(directory).isSymbolicLink()) return;
    items = fs.readdirSync(directory, { withFileTypes: true });
  } catch { return; }
  for (const item of items) {
    if (!item.isFile() || item.name.startsWith('.') || !item.name.toLowerCase().endsWith('.md')) continue;
    const source = path.join(directory, item.name);
    try { store.importFile(source, 'skill', false); }
    catch (error) { recordScanError(errors, source, error); }
  }
}

export async function scanAndPersistLibraryProviderSkills(
  store: LibraryStore,
  workspacePath: string | undefined,
  reader: ProviderSkillsReader = providerSkillsService,
  userHome?: string,
  errors?: LibraryScanError[],
) {
  const result = await listLibraryProviderSkills(workspacePath, reader);
  for (const provider of result.providers) {
    if ('error' in provider && provider.error) recordScanError(errors, `provider:${provider.provider}`, provider.error);
    for (const skill of provider.skills) {
      if (!skill.sourcePath || skill.scope !== 'user' || skill.pluginId || skill.pluginName) continue;
      importSkillFile(store, skill.sourcePath, errors);
    }
  }
  if (userHome) {
    for (const directory of [path.join(userHome, '.grok', 'skills'), path.join(userHome, '.claude', 'skills', 'synced')]) {
      try { importLibraryDirectory(store, directory, 'skill', false, errors); }
      catch (error) { recordScanError(errors, directory, error); }
    }
    importPersonalClaudeCommands(store, path.join(userHome, '.claude', 'commands'), errors);
  }
  return result;
}

function libraryInstalledRoots(project: string) {
  return (readLibraryManifest(project) ?? []).filter((entry) => entry.kind === 'skill').map((entry) => {
    const root = path.join(project, skillRoot(entry.slug, entry.claudeOnly === true));
    try { return fs.realpathSync(root); } catch { return root; }
  });
}

export async function scanAndPersistLibraryProjectSkills(
  store: LibraryStore,
  projectPaths: string[],
  reader: ProviderSkillsReader = providerSkillsService,
  errors?: LibraryScanError[],
) {
  for (const project of new Set(projectPaths)) {
    let real: string;
    try {
      real = fs.realpathSync(project);
      if (!fs.statSync(real).isDirectory()) continue;
    } catch { continue; }
    const owned = libraryInstalledRoots(real);
    const { providers } = await listLibraryProviderSkills(real, reader);
    for (const provider of providers) {
      if ('error' in provider && provider.error) recordScanError(errors, `provider:${provider.provider}:${real}`, provider.error);
      for (const skill of provider.skills) {
        if (!skill.sourcePath || (skill.scope !== 'project' && skill.scope !== 'repo') || skill.pluginId || skill.pluginName) continue;
        let source: string;
        try { source = fs.realpathSync(skill.sourcePath); }
        catch (error) { recordScanError(errors, skill.sourcePath, error); continue; }
        if (owned.some((root) => source === root || source.startsWith(root + path.sep))) continue;
        importSkillFile(store, skill.sourcePath, errors);
      }
    }
  }
}
