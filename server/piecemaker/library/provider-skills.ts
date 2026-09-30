import fs from 'node:fs';
import path from 'node:path';

import { providerSkillsService } from '@/modules/providers/index.js';
import type { LLMProvider, ProviderSkillListOptions } from '@/shared/types.js';

import { importLibraryDirectory } from './migrate.js';
import { recordScanError, type LibraryScanError } from './scan-errors.js';
import type { createLibraryStore } from './store.js';

type LibraryStore = ReturnType<typeof createLibraryStore>;

const LIBRARY_SKILL_PROVIDERS: LLMProvider[] = ['claude', 'codex', 'cursor', 'mistral', 'opencode'];

type ProviderSkillsReader = {
  listProviderSkills(provider: string, options?: ProviderSkillListOptions): ReturnType<typeof providerSkillsService.listProviderSkills>;
};

export async function listLibraryProviderSkills(
  workspacePath: string | undefined,
  reader: ProviderSkillsReader = providerSkillsService,
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

function realDirectory(directory: string) {
  try {
    const resolved = fs.realpathSync(directory);
    return fs.statSync(resolved).isDirectory() ? resolved : null;
  } catch { return null; }
}

// Skills de projet de tous les dossiers connus, hors liens matérialisés par la bibliothèque.
export async function scanAndPersistLibraryProjectSkills(
  store: LibraryStore,
  projectPaths: string[],
  reader: ProviderSkillsReader = providerSkillsService,
  errors?: LibraryScanError[],
) {
  const libraryRoot = realDirectory(store.directory);
  const prefix = libraryRoot ? `${libraryRoot}${path.sep}` : null;
  for (const project of new Set(projectPaths)) {
    if (!realDirectory(project)) continue;
    const { providers } = await listLibraryProviderSkills(project, reader);
    for (const provider of providers) {
      if ('error' in provider && provider.error) recordScanError(errors, `provider:${provider.provider}:${project}`, provider.error);
      for (const skill of provider.skills) {
        if (!skill.sourcePath || (skill.scope !== 'project' && skill.scope !== 'repo') || skill.pluginId || skill.pluginName) continue;
        try {
          const real = fs.realpathSync(skill.sourcePath);
          if (prefix && (real.startsWith(prefix))) continue;
        } catch (error) { recordScanError(errors, skill.sourcePath, error); continue; }
        importSkillFile(store, skill.sourcePath, errors);
      }
    }
  }
}

export { scanAndPersistLibraryClaudeAgents, scanAndPersistLibraryProviderAgents } from './provider-agents.js';
