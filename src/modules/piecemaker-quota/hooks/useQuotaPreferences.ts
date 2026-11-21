import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { LLMProvider } from '@/shared/types';
import { QUOTA_PROVIDERS } from '@/modules/piecemaker-quota/utils/quotaResume';
import type { QuotaChainEntry, QuotaResumeMode, QuotaResumePreferences } from '@/modules/piecemaker-quota/utils/quotaResume';

const PREFERENCE_KEY = 'piecemakerQuotaResume';
const DEFAULT_PREFERENCES: QuotaResumePreferences = { mode: 'off', chain: [] };

let cached: QuotaResumePreferences | null = null;
let loading: Promise<QuotaResumePreferences> | null = null;
const listeners = new Set<(value: QuotaResumePreferences) => void>();

function readPreferences(raw: unknown): QuotaResumePreferences {
  if (!raw || typeof raw !== 'object') return DEFAULT_PREFERENCES;
  const record = raw as Record<string, unknown>;
  const mode: QuotaResumeMode = record.mode === 'wait' || record.mode === 'chain' ? record.mode : 'off';
  const chain = Array.isArray(record.chain)
    ? record.chain.flatMap((entry): QuotaChainEntry[] => {
      const item = entry as Record<string, unknown> | null;
      const provider = item?.provider as LLMProvider;
      return item && QUOTA_PROVIDERS.includes(provider) && typeof item.model === 'string' && item.model
        ? [{ provider, model: item.model }]
        : [];
    })
    : [];
  return { mode, chain };
}

function loadPreferences(): Promise<QuotaResumePreferences> {
  if (cached) return Promise.resolve(cached);
  loading ??= api.user.preferences()
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => {
      cached = readPreferences(payload?.preferences?.[PREFERENCE_KEY]);
      return cached;
    })
    .catch(() => DEFAULT_PREFERENCES)
    .finally(() => {
      loading = null;
    });
  return loading;
}

export function useQuotaPreferences() {
  const [preferences, setPreferences] = useState<QuotaResumePreferences | null>(cached);

  useEffect(() => {
    let active = true;
    listeners.add(setPreferences);
    void loadPreferences().then((value) => {
      if (active) setPreferences(value);
    });
    return () => {
      active = false;
      listeners.delete(setPreferences);
    };
  }, []);

  const save = useCallback((next: QuotaResumePreferences) => {
    cached = next;
    listeners.forEach((listener) => listener(next));
    void api.user.savePreferences({ [PREFERENCE_KEY]: next }).catch((error: unknown) => {
      console.error('Failed to save quota resume preferences:', error);
    });
  }, []);

  return { preferences, save };
}
