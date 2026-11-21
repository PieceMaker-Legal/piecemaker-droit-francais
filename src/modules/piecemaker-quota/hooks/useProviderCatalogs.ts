import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { LLMProvider, ProviderModelsDefinition } from '@/shared/types';
import { QUOTA_PROVIDERS } from '@/modules/piecemaker-quota/utils/quotaResume';

export type ProviderCatalogs = Partial<Record<LLMProvider, ProviderModelsDefinition>>;

let cached: ProviderCatalogs | null = null;
let loading: Promise<ProviderCatalogs> | null = null;

async function loadCatalog(provider: LLMProvider): Promise<ProviderModelsDefinition | null> {
  try {
    const response = await api.providers.models(provider);
    const body = await response.json();
    const models = body?.success ? body.data?.models : null;
    return models && Array.isArray(models.OPTIONS) ? models as ProviderModelsDefinition : null;
  } catch {
    return null;
  }
}

function loadCatalogs(): Promise<ProviderCatalogs> {
  if (cached) return Promise.resolve(cached);
  loading ??= Promise.all(QUOTA_PROVIDERS.map(async (provider) => [provider, await loadCatalog(provider)] as const))
    .then((entries) => {
      cached = Object.fromEntries(entries.filter(([, catalog]) => catalog && catalog.OPTIONS.length > 0)) as ProviderCatalogs;
      return cached;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

export function useProviderCatalogs(enabled = true) {
  const [catalogs, setCatalogs] = useState<ProviderCatalogs | null>(cached);

  useEffect(() => {
    if (!enabled || cached) return;
    let active = true;
    void loadCatalogs().then((value) => {
      if (active) setCatalogs(value);
    });
    return () => {
      active = false;
    };
  }, [enabled]);

  return catalogs;
}
