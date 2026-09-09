import type { IProviderSkills } from '@/shared/interfaces.js';
import type { ProviderSkill, ProviderSkillListOptions, ProviderSkillCreateInput, ProviderSkillRemoveInput } from '@/shared/types.js';

export class MistralSkillsProvider implements IProviderSkills {
  getProviderId(): string {
    return 'mistral';
  }

  async listSkills(_options?: ProviderSkillListOptions): Promise<ProviderSkill[]> {
    return [];
  }

  async addSkills(_input: ProviderSkillCreateInput): Promise<ProviderSkill[]> {
    return [];
  }

  async removeSkill(_input: ProviderSkillRemoveInput): Promise<{ removed: boolean; provider: 'mistral'; directoryName: string }> {
    return { removed: false, provider: 'mistral', directoryName: '' };
  }
}
