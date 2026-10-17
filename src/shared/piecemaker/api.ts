import { authenticatedFetch } from '@/shared/api';
import type { PseudonymizationModelId, PseudonymizationModelStatus, PseudonymizationInstallJob } from '@/shared/piecemaker/types';

async function localModelsResponse<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload.error || 'Impossible de joindre le système de pseudonymisation.'), { status: response.status });
  return payload as T;
}

export const pseudonymizationApi = {
  status: () => authenticatedFetch('/api/piecemaker/configuration').then((response) =>
    localModelsResponse<{ components: Record<PseudonymizationModelId, PseudonymizationModelStatus> }>(response)),
  jobs: () => authenticatedFetch('/api/piecemaker/configuration/install').then((response) =>
    localModelsResponse<{ jobs: PseudonymizationInstallJob[]; busy: boolean; paused: boolean }>(response)),
  install: (component: PseudonymizationModelId) => authenticatedFetch('/api/piecemaker/configuration/install', {
    method: 'POST', body: JSON.stringify({ component }),
  }).then((response) => localModelsResponse<{ job: PseudonymizationInstallJob }>(response)),
  pause: () => authenticatedFetch('/api/piecemaker/configuration/install/pause', { method: 'POST' }).then((response) =>
    localModelsResponse<{ job: PseudonymizationInstallJob | null }>(response)),
};
