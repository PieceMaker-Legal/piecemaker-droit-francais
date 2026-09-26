import type { ProviderModelOption } from '@/shared/types.js';

type VibeModelPreset = {
  name: string;
  provider: string;
  alias: string;
  display_name: string;
  adjustableReasoning: boolean;
};

export const VIBE_MODEL_PRESETS: readonly VibeModelPreset[] = [
  { name: 'mistral-vibe-cli-latest', provider: 'mistral', alias: 'mistral-medium-3.5', display_name: 'Mistral Medium 3.5', adjustableReasoning: true },
  { name: 'zai-glm-5-3', provider: 'mistral', alias: 'glm-5.3', display_name: 'Z.ai GLM 5.3', adjustableReasoning: false },
  { name: 'zai-glm-5-2', provider: 'mistral', alias: 'glm-5.2', display_name: 'Z.ai GLM 5.2', adjustableReasoning: false },
];

export const VIBE_REASONING_EFFORT: NonNullable<ProviderModelOption['effort']> = {
  default: 'high',
  values: [
    { value: 'none', description: 'Minimal thinking, no reasoning trace.' },
    { value: 'high', description: 'Full reasoning before answering.' },
  ],
};

const VIBE_THINKING_BY_EFFORT: Record<string, string> = { none: 'low', high: 'high' };

export function vibeModelOption(alias: string, label: string, description?: string): ProviderModelOption {
  const preset = VIBE_MODEL_PRESETS.find((candidate) => candidate.alias === alias);
  return {
    value: alias,
    label,
    ...(description ? { description } : {}),
    ...(preset?.adjustableReasoning ? { effort: VIBE_REASONING_EFFORT } : {}),
  };
}

export function buildVibeModelsEnvironment(selectedAlias?: string, effort?: string): string {
  const thinking = effort ? VIBE_THINKING_BY_EFFORT[effort] : undefined;
  return JSON.stringify(Object.fromEntries(VIBE_MODEL_PRESETS.map(({ adjustableReasoning, ...model }) => [
    model.alias,
    adjustableReasoning && thinking && model.alias === selectedAlias ? { ...model, thinking } : model,
  ])));
}
