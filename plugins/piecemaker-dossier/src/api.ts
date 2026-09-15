import type { KnowledgeSnapshot, KnowledgeUpdateOperation } from './types.js';

export type KnowledgeOverview = { projectId: string; counts: Record<string, number>; total: number };
export type KnowledgeMappingView = Pick<KnowledgeSnapshot, 'projectId' | 'nodes' | 'mappings'>;
export type KnowledgeChronologyView = { projectId: string; documents: KnowledgeSnapshot['nodes']; links: KnowledgeSnapshot['links'] };
export type AgentsDocument = { projectId: string; content: string; exists: boolean };

const BASE = '/api/piecemaker/knowledge';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('auth-token');
  const response = await fetch(`${BASE}${path}`, {
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
  overview: (projectId: string) => request<KnowledgeOverview>(`/overview${query(projectId)}`),
  mapping: (projectId: string) => request<KnowledgeMappingView>(`/mapping${query(projectId)}`),
  chronology: (projectId: string) => request<KnowledgeChronologyView>(`/chronology${query(projectId)}`),
  graph: (projectId: string) => request<KnowledgeSnapshot>(`/graph${query(projectId)}`),
  agents: (projectId: string) => request<AgentsDocument>(`/agents${query(projectId)}`),
  scan: (projectId: string) => request('/scan', { method: 'POST', body: JSON.stringify({ projectId }) }),
  update: (projectId: string, operations: KnowledgeUpdateOperation[]) => request('/update', { method: 'POST', body: JSON.stringify({ projectId, operations }) }),
};
