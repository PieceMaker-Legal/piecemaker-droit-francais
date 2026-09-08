import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getAddonsData } from '@/piecemaker/addons/api';

export function useAddonsData<T>(endpoint: string | null) {
  const { t } = useTranslation('addons');
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    if (!endpoint) {
      setData(null);
      setError('');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    void getAddonsData<T>(endpoint)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : t('errors.resourceUnavailable')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [endpoint, reloadVersion, t]);

  const reload = useCallback(() => setReloadVersion((version) => version + 1), []);

  return { data, error, loading, reload };
}
