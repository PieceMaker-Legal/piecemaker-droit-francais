import type { ReasoningDraftCheck, ReasoningSnapshot } from '../../../shared/piecemaker-reasoning.js';

export function loadReasoning(projectPath: string | null, example = false): Promise<ReasoningSnapshot> {
  return request<ReasoningSnapshot>(`/api/piecemaker/reasoning${example ? '/example' : `?projectPath=${encodeURIComponent(projectPath ?? '')}`}`);
}

export function reviewReasoning(projectPath: string, id: string, decision: 'retained' | 'rejected' | null, note?: string): Promise<ReasoningSnapshot> {
  return request<ReasoningSnapshot>('/api/piecemaker/reasoning/review', { projectPath, id, decision, note });
}

export function checkDraft(projectPath: string, file: string): Promise<ReasoningDraftCheck> {
  return request<ReasoningDraftCheck>('/api/piecemaker/reasoning/draft-check', { projectPath, file });
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
