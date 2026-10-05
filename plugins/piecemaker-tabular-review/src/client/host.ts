import type { Provider } from '../shared.js';
import type { CasePiece, Pseudonym } from './sorting.js';

export type PluginContext = {
  theme: 'dark' | 'light';
  project: { name: string; path: string } | null;
  session: { id: string; title: string } | null;
};

export type PluginApi = {
  readonly context: PluginContext;
  onContextChange(callback: (context: PluginContext) => void): () => void;
  rpc(method: string, path: string, body?: unknown): Promise<unknown>;
  openFileInEditor?(filePath: string): void;
};

export type HostProject = {
  projectId: string;
  displayName: string;
  fullPath: string;
};

export type ModelOption = { value: string; label: string; description?: string };

type AnonymizerStatus = { enabled?: boolean; listening?: boolean; origin?: string | null; reason?: string };

type ProviderModelsResponse = { data?: { models?: { OPTIONS?: ModelOption[]; DEFAULT?: string } } };

async function hostJson<T>(url: string, body?: unknown): Promise<T> {
  const token = localStorage.getItem('auth-token');
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(url, body === undefined
    ? { headers }
    : { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const refreshed = response.headers.get('X-Refreshed-Token');
  if (refreshed) {
    localStorage.setItem('auth-token', refreshed);
    window.dispatchEvent(new CustomEvent('auth-token-refreshed', { detail: refreshed }));
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof detail?.error === 'string' ? detail.error : `Erreur ${response.status} sur ${url}`);
  }
  return response.json() as Promise<T>;
}

export function createRpc(api: PluginApi) {
  return async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const result = await api.rpc(method, path, body) as T & { error?: string };
    if (result && typeof result === 'object' && typeof result.error === 'string') throw new Error(result.error);
    return result;
  };
}

export type Rpc = ReturnType<typeof createRpc>;

export async function loadHostProjects(): Promise<HostProject[]> {
  const projects = await hostJson<HostProject[]>('/api/projects');
  return (Array.isArray(projects) ? projects : [])
    .filter((project) => project && typeof project.fullPath === 'string' && project.fullPath)
    .map((project) => ({ projectId: project.projectId, displayName: project.displayName || project.fullPath, fullPath: project.fullPath }));
}

export async function anonymizationProxyOrigin(): Promise<string> {
  const status = await hostJson<AnonymizerStatus>('/api/piecemaker/anonymizer/status');
  if (!status.enabled || !status.listening || !status.origin) {
    throw new Error('Le proxy d’anonymisation n’est pas actif : aucune session IA ne peut être lancée sans lui.');
  }
  return status.origin;
}

export const CHEAP_MODEL_PATTERN = /haiku|luna|mini|nano|spark|flash|small/i;

export async function loadModels(provider: Provider): Promise<{ options: ModelOption[]; cheapest: string }> {
  const response = await hostJson<ProviderModelsResponse>(`/api/providers/${provider}/models`);
  const options = (response.data?.models?.OPTIONS ?? []).filter((option) => option && typeof option.value === 'string');
  const cheapest = options.find((option) => CHEAP_MODEL_PATTERN.test(`${option.value} ${option.label}`))?.value
    ?? (provider === 'claude' ? 'haiku' : options[0]?.value ?? '');
  return { options, cheapest };
}

const KNOWLEDGE = '/api/piecemaker/knowledge';

type ConversionJob = { id: string; state: string; error?: string | null };

/** Dossier juridique vu par PieceMaker : pièces, pseudonymes, renommage et conversion. */
export const caseFiles = {
  async pieces(projectId: string): Promise<CasePiece[]> {
    return (await hostJson<{ pieces: CasePiece[] }>(`${KNOWLEDGE}/pieces?projectId=${encodeURIComponent(projectId)}`)).pieces;
  },
  async pseudonyms(projectId: string): Promise<Pseudonym[]> {
    const graph = await hostJson<{ nodes: { id: string; label: string }[]; mappings: { nodeId: string; real: string; masked: string }[] }>(`${KNOWLEDGE}/graph?projectId=${encodeURIComponent(projectId)}`);
    const labels = new Map(graph.nodes.map((node) => [node.id, node.label]));
    return graph.mappings.map((mapping) => ({ masked: mapping.masked, real: labels.get(mapping.nodeId) || mapping.real }));
  },
  rename(projectId: string, piece: string, name: string | undefined, directory: string | undefined) {
    return hostJson<{ previous: string; current: string; markdown: string | null }>(`${KNOWLEDGE}/rename`, { projectId, path: piece, name, directory });
  },
  /** Convertit les pièces indiquées et attend la fin de la conversion. */
  async convert(projectId: string, files: string[]): Promise<void> {
    let { job } = await hostJson<{ job: ConversionJob }>(`${KNOWLEDGE}/scan`, { projectId, files });
    while (job.state === 'running') {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      ({ job } = await hostJson<{ job: ConversionJob }>(`${KNOWLEDGE}/scan/job?id=${encodeURIComponent(job.id)}&projectId=${encodeURIComponent(projectId)}`));
    }
    if (job.state !== 'done') throw new Error(job.error || `Conversion interrompue (${job.state}).`);
  },
};
