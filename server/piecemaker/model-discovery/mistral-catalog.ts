import type { ProviderModelsDefinition } from '@/shared/types.js';

import { withStdioRpcServer, type RpcCall } from './stdio-rpc.js';

type VibeModelView = {
  name: string;
  alias: string;
  displayName?: string;
};

type VibeConfigRead = {
  config?: {
    models?: VibeModelView[];
    activeModel?: { alias?: string } | null;
    defaultModelAlias?: string;
  };
};

export async function listVibeModels(call: RpcCall): Promise<ProviderModelsDefinition> {
  const { config } = await call('config/read', {}) as VibeConfigRead;
  const models = (config?.models ?? []).filter((model) => model.alias);
  if (models.length === 0) throw new Error('vibe-app-server listed no models');

  const aliases = new Set(models.map((model) => model.alias));
  const preferred = [config?.activeModel?.alias, config?.defaultModelAlias].find((alias) => alias && aliases.has(alias));
  return {
    OPTIONS: models.map((model) => ({
      value: model.alias,
      label: model.displayName || model.alias,
      description: model.name,
    })),
    DEFAULT: preferred ?? models[0].alias,
  };
}

export function discoverMistralModels(timeoutMs: number): Promise<ProviderModelsDefinition> {
  return withStdioRpcServer({ command: 'vibe-app-server', args: [] }, listVibeModels, timeoutMs);
}
