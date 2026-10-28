import type { SuiviDossier, SuiviSnapshot } from '../../../shared/piecemaker-suivi.js';

export function loadAll(): Promise<SuiviDossier[]> {
  return request<SuiviDossier[]>('/api/piecemaker/suivi/tous');
}

export function verifySuivi(projectPath: string): Promise<SuiviSnapshot> {
  return request<SuiviSnapshot>('/api/piecemaker/suivi/verify', { projectPath });
}

export function markDone(projectPath: string, echeance: string, input: { date?: string; piece?: string | null; annuler?: boolean }): Promise<SuiviSnapshot> {
  return request<SuiviSnapshot>('/api/piecemaker/suivi/fait', { projectPath, echeance, ...input });
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
