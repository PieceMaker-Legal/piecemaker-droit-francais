import type { ReasoningSnapshot, ReasoningTestRun, ReasoningValue } from '../../../shared/piecemaker-reasoning.js';

export function loadReasoning(projectPath: string | null, example = false): Promise<ReasoningSnapshot> {
  return request<ReasoningSnapshot>(`/api/piecemaker/reasoning${example ? '/example' : `?projectPath=${encodeURIComponent(projectPath ?? '')}`}`);
}

export function reviewItem(projectPath: string, id: string, status: 'validé' | 'écarté' | null, note?: string): Promise<ReasoningSnapshot> {
  return request<ReasoningSnapshot>('/api/piecemaker/reasoning/review', { projectPath, id, status, note });
}

export function appreciateFact(projectPath: string, id: string, input: { value: ReasoningValue; force: string | null; appreciation: string; note?: string }): Promise<ReasoningSnapshot> {
  return request<ReasoningSnapshot>('/api/piecemaker/reasoning/appreciation', { projectPath, id, ...input });
}

export function runTest(projectPath: string, scope: string, values: Record<string, ReasoningValue>): Promise<ReasoningTestRun> {
  return request<ReasoningTestRun>('/api/piecemaker/reasoning/test/run', { projectPath, scope, values });
}

export function saveTest(projectPath: string, input: { label: string; scope: string; values: Record<string, ReasoningValue>; expected: string }): Promise<ReasoningSnapshot> {
  return request<ReasoningSnapshot>('/api/piecemaker/reasoning/test', { projectPath, ...input });
}

export function deleteTest(projectPath: string, id: string): Promise<ReasoningSnapshot> {
  return request<ReasoningSnapshot>('/api/piecemaker/reasoning/test/delete', { projectPath, id });
}

async function request<T>(url: string, body?: object): Promise<T> {
  const token = localStorage.getItem('auth-token');
  const response = await fetch(url, { ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) } });
  const refreshed = response.headers.get('X-Refreshed-Token');
  if (refreshed) {
    localStorage.setItem('auth-token', refreshed);
    window.dispatchEvent(new CustomEvent('auth-token-refreshed', { detail: refreshed }));
  }
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
  return data;
}
