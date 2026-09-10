import { providerSkillsService } from '@/modules/providers/index.js';
import type { LLMProvider, ProviderSkillListOptions } from '@/shared/types.js';

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
