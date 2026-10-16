import type { ReasoningSnapshot } from '../../../shared/piecemaker-reasoning.js';

export async function loadReasoning(projectPath: string | null, example = false): Promise<ReasoningSnapshot> {
  const token = localStorage.getItem('auth-token');
  const response = await fetch(`/api/piecemaker/reasoning${example ? '/example' : `?projectPath=${encodeURIComponent(projectPath ?? '')}`}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const refreshed = response.headers.get('X-Refreshed-Token');
  if (refreshed) {
    localStorage.setItem('auth-token', refreshed);
    window.dispatchEvent(new CustomEvent('auth-token-refreshed', { detail: refreshed }));
  }
  const data = await response.json() as ReasoningSnapshot & { error?: string };
  if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
  return data;
}
