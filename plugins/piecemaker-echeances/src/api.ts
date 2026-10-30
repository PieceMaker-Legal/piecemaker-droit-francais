import type { SuiviDossier, SuiviSnapshot } from '../../../shared/piecemaker-suivi.js';

const BOARD_PAGE = '/api/plugins/piecemaker-echeances/assets/board/index.html';

export function loadAll(): Promise<SuiviDossier[]> {
  return request<SuiviDossier[]>('/api/piecemaker/suivi/tous');
}

export function verifySuivi(projectPath: string, suivi: string): Promise<SuiviSnapshot> {
  return request<SuiviSnapshot>('/api/piecemaker/suivi/verify', { projectPath, suivi });
}

export async function loadBoardPage(): Promise<string> {
  const response = await send(BOARD_PAGE);
  if (!response.ok) throw new Error(`Erreur ${response.status}`);
  return response.text();
}

async function send(url: string, body?: object) {
  const token = localStorage.getItem('auth-token');
  const response = await fetch(url, { ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) } });
  const refreshed = response.headers.get('X-Refreshed-Token');
  if (refreshed) {
    localStorage.setItem('auth-token', refreshed);
    window.dispatchEvent(new CustomEvent('auth-token-refreshed', { detail: refreshed }));
  }
  return response;
}

async function request<T>(url: string, body?: object): Promise<T> {
  const response = await send(url, body);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
  return data;
}
