import { useEffect, useRef, useState } from 'react';

import { pseudonymizationApi } from '@/shared/piecemaker/api';
import { getStoredAuthToken } from '@/shared/authToken';
import type { PseudonymizationInstallJob, PseudonymizationModelId, PseudonymizationModelStatus } from '@/shared/piecemaker/types';

const MODEL_IDS: PseudonymizationModelId[] = ['gliner', 'mineru'];

export function usePseudonymization() {
  const [models, setModels] = useState<Partial<Record<PseudonymizationModelId, PseudonymizationModelStatus>>>({});
  const [jobs, setJobs] = useState<PseudonymizationInstallJob[]>([]);
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
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
        setPaused(response.paused);
        if (response.busy || response.paused) return;
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

  const pause = async () => {
    try {
      const { job } = await pseudonymizationApi.pause();
      setPaused(true);
      if (job) setJobs((current) => [...current.filter((entry) => entry.component !== job.component), { ...job, state: 'paused' }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const resume = async () => {
    const missing = MODEL_IDS.find((id) => !models[id]?.installed);
    if (!missing) return;
    try {
      attempted.current.add(missing);
      const { job } = await pseudonymizationApi.install(missing);
      setPaused(false);
      setJobs((current) => [...current.filter((entry) => entry.component !== missing), job]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return { models, jobs, error, paused, retry: () => attempted.current.clear(), pause, resume };
}
