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
      value: 'mistral-large-latest',
      label: 'Mistral Large',
      description: 'Most powerful Mistral model for complex reasoning and advanced tasks.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
        ],
      },
    },
    {
      value: 'mistral-medium-latest',
      label: 'Mistral Medium',
      description: 'Balanced model for everyday tasks and coding.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
        ],
      },
    },
    {
      value: 'mistral-small-latest',
      label: 'Mistral Small',
      description: 'Fast and efficient model for simpler tasks.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
        ],
      },
    },
    {
      value: 'codestral-latest',
      label: 'Codestral',
      description: 'Mistral model specialized for coding and development tasks.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
        ],
      },
    },
  ],
  DEFAULT: 'mistral-large-latest',
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
