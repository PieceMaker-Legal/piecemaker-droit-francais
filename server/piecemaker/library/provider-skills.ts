import { providerSkillsService } from '@/modules/providers/index.js';
import type { LLMProvider, ProviderSkillListOptions } from '@/shared/types.js';

import type { createLibraryStore } from './store.js';

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
  store: ReturnType<typeof createLibraryStore>,
  workspacePath: string | undefined,
  reader: ProviderSkillsReader = providerSkillsService,
) {
  const result = await listLibraryProviderSkills(workspacePath, reader);
  for (const provider of result.providers) {
    for (const skill of provider.skills) {
      if (!skill.sourcePath || skill.scope !== 'user' || skill.pluginId || skill.pluginName) continue;
      try { store.importFile(skill.sourcePath, 'skill'); }
      catch { try { store.importFile(skill.sourcePath, 'skill', false); } catch {} }
    }
  }
  return result;
}

export { scanAndPersistLibraryClaudeAgents, scanAndPersistLibraryProviderAgents } from './provider-agents.js';
