import { VIBE_MODEL_PRESETS, vibeModelOption } from '@/modules/providers/list/mistral/mistral-vibe-models.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import { buildDefaultProviderCurrentActiveModel } from '@/shared/utils.js';

/** Curated Mistral catalog shipped as immutable CloudCLI defaults. */
export const MISTRAL_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    ...VIBE_MODEL_PRESETS.map((preset) => vibeModelOption(preset.alias, preset.display_name, preset.name)),
    vibeModelOption('local', 'Devstral (local)', 'devstral'),
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
