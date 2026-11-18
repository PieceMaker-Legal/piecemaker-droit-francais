import { requestJson } from '../../../src/shared/authToken.js';
import type { CatalaSnapshot } from './client.js';

export function loadCatala(projectPath: string): Promise<CatalaSnapshot> {
  return requestJson<CatalaSnapshot>(`/api/piecemaker/catala?projectPath=${encodeURIComponent(projectPath)}`);
}

export function verifyCatala(projectPath: string, programme: string): Promise<CatalaSnapshot> {
  return requestJson<CatalaSnapshot>('/api/piecemaker/catala/verify', { projectPath, programme });
}

export function citeCatala(projectPath: string, programme: string, fichier: string, source: string, citation: string, parent = ''): Promise<{ token: string }> {
  return requestJson('/api/piecemaker/catala/citation', { projectPath, programme, fichier, source, citation, ...(parent ? { parent } : {}) });
}
