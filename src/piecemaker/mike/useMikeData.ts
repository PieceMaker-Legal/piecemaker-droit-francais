import { useCallback, useEffect, useState } from 'react';

import { getMikeData } from '@/piecemaker/mike/api';

export function useMikeData<T>(endpoint: string | null) {
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
    void getMikeData<T>(endpoint)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'La ressource Mike est indisponible.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [endpoint, reloadVersion]);

  const reload = useCallback(() => setReloadVersion((version) => version + 1), []);

  return { data, error, loading, reload };
}
