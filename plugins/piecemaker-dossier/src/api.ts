import type { KnowledgeSnapshot, KnowledgeUpdateOperation } from './types.js';

export type KnowledgeOverview = { projectId: string; counts: Record<string, number>; total: number };
export type KnowledgeMappingView = Pick<KnowledgeSnapshot, 'projectId' | 'nodes' | 'mappings' | 'exclusions'>;
export type KnowledgeChronologyView = { projectId: string; documents: KnowledgeSnapshot['nodes']; links: KnowledgeSnapshot['links'] };
export type AgentsDocument = { projectId: string; content: string; exists: boolean };
export type KnowledgeDocumentPreview = { path: string; content: string };

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

export const knowledgeApi = {
  overview: (projectId: string) => request<KnowledgeOverview>(BASE, `/overview${query(projectId)}`),
  mapping: (projectId: string) => request<KnowledgeMappingView>(BASE, `/mapping${query(projectId)}`),
  chronology: (projectId: string) => request<KnowledgeChronologyView>(BASE, `/chronology${query(projectId)}`),
  graph: (projectId: string) => request<KnowledgeSnapshot>(BASE, `/graph${query(projectId)}`),
  agents: (projectId: string) => request<AgentsDocument>(BASE, `/agents${query(projectId)}`),
  document: (projectId: string, path: string) => request<KnowledgeDocumentPreview>(PIECEMAKER_BASE, `/repository/document?case=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}`),
  scan: (projectId: string) => request(BASE, '/scan', { method: 'POST', body: JSON.stringify({ projectId }) }),
  update: (projectId: string, operations: KnowledgeUpdateOperation[]) => request(BASE, '/update', { method: 'POST', body: JSON.stringify({ projectId, operations }) }),
};
