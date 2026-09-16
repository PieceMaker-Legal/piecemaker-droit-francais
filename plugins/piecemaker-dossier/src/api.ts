import type { KnowledgeNode, KnowledgeSnapshot, KnowledgeUpdateOperation } from './types.js';

export type KnowledgeOverview = { projectId: string; counts: Record<string, number>; total: number };
export type KnowledgeMappingView = Pick<KnowledgeSnapshot, 'projectId' | 'nodes' | 'mappings' | 'exclusions'>;
export type KnowledgeChronologyDocument = Omit<KnowledgeNode, 'id'>;
export type KnowledgeChronologyView = { projectId: string; documents: KnowledgeChronologyDocument[]; links: KnowledgeSnapshot['links'] };
export type AgentsDocument = { projectId: string; content: string; exists: boolean };
export type KnowledgeDocumentPreview = { path: string; content: string };
export type InstitutionalTerms = { file: string; terms: string[] };
export type ScanJob = {
  id: string;
  projectId: string;
  state: 'running' | 'done' | 'error' | 'cancelled';
  percent: number;
  error: string | null;
};
type RepositoryCase = { path: string; location: string };
type RepositoryOverview = { folders?: RepositoryCase[] };
type RegisteredCase = { folder: RepositoryCase };

const BASE = '/api/piecemaker/knowledge';
const PIECEMAKER_BASE = '/api/piecemaker';

async function request<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('auth-token');
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const refreshed = response.headers.get('X-Refreshed-Token');
  if (refreshed) {
    localStorage.setItem('auth-token', refreshed);
    window.dispatchEvent(new CustomEvent('auth-token-refreshed', { detail: refreshed }));
  }
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
  return data;
}

const query = (projectId: string): string => `?projectId=${encodeURIComponent(projectId)}`;
const caseReferences = new Map<string, Promise<string>>();

function caseReference(projectPath: string): Promise<string> {
  const existing = caseReferences.get(projectPath);
  if (existing) return existing;
  const pending = request<RepositoryOverview>(PIECEMAKER_BASE, '/repository')
    .then(async (overview) => {
      const registered = overview.folders?.find((entry) => entry.location === projectPath);
      if (registered) return registered.path;
      const result = await request<RegisteredCase>(PIECEMAKER_BASE, '/repository/cases/selected', { method: 'POST', body: JSON.stringify({ folder: projectPath }) });
      return result.folder.path;
    })
    .catch((error) => {
      caseReferences.delete(projectPath);
      throw error;
    });
  caseReferences.set(projectPath, pending);
  return pending;
}

export const knowledgeApi = {
  overview: (projectId: string) => request<KnowledgeOverview>(BASE, `/overview${query(projectId)}`),
  mapping: (projectId: string) => request<KnowledgeMappingView>(BASE, `/mapping${query(projectId)}`),
  chronology: (projectId: string) => request<KnowledgeChronologyView>(BASE, `/chronology${query(projectId)}`),
  graph: (projectId: string) => request<KnowledgeSnapshot>(BASE, `/graph${query(projectId)}`),
  agents: (projectId: string) => request<AgentsDocument>(BASE, `/agents${query(projectId)}`),
  document: async (projectPath: string, path: string) => {
    if (!projectPath) throw new Error('Le chemin du dossier CloudCLI est indisponible.');
    const reference = await caseReference(projectPath);
    return request<KnowledgeDocumentPreview>(PIECEMAKER_BASE, `/repository/document?case=${encodeURIComponent(reference)}&path=${encodeURIComponent(path)}`);
  },
  scan: (projectId: string) => request<{ job: ScanJob }>(BASE, '/scan', { method: 'POST', body: JSON.stringify({ projectId }) }),
  scanJob: (jobId: string, projectId: string) => request<{ job: ScanJob | null }>(BASE, `/scan/job?id=${encodeURIComponent(jobId)}&projectId=${encodeURIComponent(projectId)}`),
  cancelScan: (jobId: string, projectId: string) => request<{ job: ScanJob | null }>(BASE, '/scan/cancel', { method: 'POST', body: JSON.stringify({ id: jobId, projectId }) }),
  update: (projectId: string, operations: KnowledgeUpdateOperation[]) => request(BASE, '/update', { method: 'POST', body: JSON.stringify({ projectId, operations }) }),
  institutionalTerms: () => request<InstitutionalTerms>(PIECEMAKER_BASE, '/institutional-terms'),
  saveInstitutionalTerms: (terms: string[]) => request<InstitutionalTerms>(PIECEMAKER_BASE, '/institutional-terms', { method: 'PUT', body: JSON.stringify({ terms }) }),
};
