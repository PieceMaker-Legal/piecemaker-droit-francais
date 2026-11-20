import { useCallback, useEffect, useRef, useState } from 'react';

export function useArtifactResource<T>(load: () => Promise<T>, poll = false) {
  const [value, setValue] = useState<T>();
  const [error, setError] = useState('');
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++request.current;
    try {
      const result = await load();
      if (current === request.current) {
        setValue(result);
        setError('');
      }
    } catch (failure) {
      if (current === request.current) setError((failure as Error).message);
    }
  }, [load]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = poll ? window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 3000) : undefined;
    return () => {
      request.current += 1;
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [poll, refresh]);

  return { value, error, refresh };
}
