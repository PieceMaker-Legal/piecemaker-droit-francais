import type { CatalaSnapshot } from './client.js';

export function loadCatala(projectPath: string): Promise<CatalaSnapshot> {
  return request<CatalaSnapshot>(`/api/piecemaker/catala?projectPath=${encodeURIComponent(projectPath)}`);
}

export function verifyCatala(projectPath: string, programme: string): Promise<CatalaSnapshot> {
  return request<CatalaSnapshot>('/api/piecemaker/catala/verify', { projectPath, programme });
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
