import { useEffect, useRef, useState } from 'react';

import { pseudonymizationApi } from '@/shared/piecemaker/api';
import { getStoredAuthToken } from '@/shared/authToken';
import type { PseudonymizationInstallJob, PseudonymizationModelId, PseudonymizationModelStatus } from '@/shared/piecemaker/types';

const MODEL_IDS: PseudonymizationModelId[] = ['gliner', 'mineru'];

export function usePseudonymization() {
  const [models, setModels] = useState<Partial<Record<PseudonymizationModelId, PseudonymizationModelStatus>>>({});
  const [jobs, setJobs] = useState<PseudonymizationInstallJob[]>([]);
  const [error, setError] = useState('');
  const attempted = useRef(new Set<PseudonymizationModelId>());

  useEffect(() => {
    let disposed = false;
    let timer: number;
    let models: Partial<Record<PseudonymizationModelId, PseudonymizationModelStatus>> | null = null;
    let finishedJobs = '';
    const poll = async () => {
      let starting: PseudonymizationModelId | undefined;
      try {
        if (!getStoredAuthToken()) return;
        const response = await pseudonymizationApi.jobs();
        if (disposed) return;
        const finished = response.jobs.filter((job) => job.state !== 'running').map((job) => job.id).join(',');
        if (!models || finished !== finishedJobs) {
          ({ components: models } = await pseudonymizationApi.status());
          if (disposed) return;
          finishedJobs = finished;
          setModels(models);
        }
        setJobs((current) => [...new Map([...current, ...response.jobs].map((job) => [job.component, job])).values()]);
        setError('');
        if (response.busy) return;
        const missing = MODEL_IDS.find((id) => !models?.[id]?.installed && !attempted.current.has(id));
        if (!missing) return;
        starting = missing;
        attempted.current.add(missing);
        const { job } = await pseudonymizationApi.install(missing);
        if (!disposed) {
          setJobs((current) => [...current.filter((entry) => entry.component !== missing), job]);
          setError('');
        }
      } catch (cause) {
        if (starting) {
          if ((cause as { status?: number })?.status === 409) {
            attempted.current.delete(starting);
          } else if (!disposed) {
            const component = starting;
            const error = cause instanceof Error ? cause.message : String(cause);
            setJobs((current) => [...current.filter((job) => job.component !== component), {
              id: `start-${component}`, component, state: 'failed', progress: '', error,
            }]);
          }
        }
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!disposed) timer = window.setTimeout(() => void poll(), 1500);
      }
    };
    void poll();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, []);

  return { models, jobs, error, retry: () => attempted.current.clear() };
}
