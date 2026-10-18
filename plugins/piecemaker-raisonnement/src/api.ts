import type { ReasoningSnapshot } from '../../../shared/piecemaker-reasoning.js';

export function loadReasoning(projectPath: string | null, example = false): Promise<ReasoningSnapshot> {
  return request<ReasoningSnapshot>(`/api/piecemaker/reasoning${example ? '/example' : `?projectPath=${encodeURIComponent(projectPath ?? '')}`}`);
}

export function verifyReasoning(projectPath: string): Promise<ReasoningSnapshot> {
  return request<ReasoningSnapshot>('/api/piecemaker/reasoning/verify', { projectPath });
}

export function dismissIssue(projectPath: string, id: string, restore = false): Promise<ReasoningSnapshot> {
  return request<ReasoningSnapshot>('/api/piecemaker/reasoning/dismiss', { projectPath, id, restore });
}

export function ratePiece(projectPath: string, piece: string, reliable: boolean | null): Promise<ReasoningSnapshot> {
  return request<ReasoningSnapshot>('/api/piecemaker/reasoning/reliability', { projectPath, piece, reliable });
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
