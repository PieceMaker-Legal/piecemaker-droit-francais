import type { IProvider } from '@/shared/interfaces.js';
import type { ProviderModelsDefinition } from '@/shared/types.js';

import { discoverCodexModels } from './codex-catalog.js';
import { discoverMistralModels } from './mistral-catalog.js';

type Discover = (timeoutMs: number) => Promise<ProviderModelsDefinition>;

type ProviderLookup = {
  resolveProvider(provider: string): Pick<IProvider, 'models'>;
};

type ModelDiscoveryOptions = {
  discoverers?: Record<string, Discover>;
  refreshAfterMs?: number;
  retryAfterMs?: number;
  timeoutMs?: number;
  now?: () => number;
  warn?: (message: string) => void;
};

const DEFAULT_DISCOVERERS: Record<string, Discover> = {
  codex: discoverCodexModels,
  mistral: discoverMistralModels,
};

export function installModelDiscovery(registry: ProviderLookup, options: ModelDiscoveryOptions = {}) {
  const {
    discoverers = DEFAULT_DISCOVERERS,
    refreshAfterMs = 10 * 60_000,
    retryAfterMs = 60_000,
    timeoutMs = 20_000,
    now = Date.now,
    warn = (message) => console.warn(message),
  } = options;

  for (const [provider, discover] of Object.entries(discoverers)) {
    const models = registry.resolveProvider(provider).models;
    const curated = models.getSupportedModels.bind(models);
    let lastDiscovered: ProviderModelsDefinition | null = null;
    let served: ProviderModelsDefinition | null = null;
    let expiresAt = 0;
    let refreshing: Promise<ProviderModelsDefinition> | null = null;

    const refresh = () => {
      refreshing ??= (async () => {
        try {
          lastDiscovered = await discover(timeoutMs);
          served = lastDiscovered;
          expiresAt = now() + refreshAfterMs;
        } catch (error) {
          warn(`[PieceMaker] ${provider} model discovery failed: ${error instanceof Error ? error.message : String(error)}`);
          served = lastDiscovered ?? await curated();
          expiresAt = now() + retryAfterMs;
        }
        return served;
      })().finally(() => { refreshing = null; });
      return refreshing;
    };

    models.getSupportedModels = async () => {
      if (!served) return refresh();
      if (now() >= expiresAt) void refresh();
      return served;
    };

    void models.getSupportedModels();
  }
}
