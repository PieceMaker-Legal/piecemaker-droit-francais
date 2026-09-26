import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import { buildDefaultProviderCurrentActiveModel } from '@/shared/utils.js';

/** Curated Mistral catalog shipped as immutable CloudCLI defaults. */
export const MISTRAL_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'mistral-medium-3.5',
      label: 'Mistral Medium 3.5',
      description: 'mistral-vibe-cli-latest',
    },
    {
      value: 'local',
      label: 'Devstral (local)',
      description: 'devstral',
    },
  ],
  DEFAULT: 'mistral-medium-3.5',
};

/** Provider registry model adapter for Mistral predefined models. */
export class MistralProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    return MISTRAL_PREDEFINED_MODELS;
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
