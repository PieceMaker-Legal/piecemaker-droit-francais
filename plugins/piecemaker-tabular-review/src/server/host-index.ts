import type { Review } from '../shared.js';
import { UserError } from './paths.js';

/** Le Case index tel que l'hôte le tient dans SQLite ; le .json de « Tabular Review » n'en est qu'une vue régénérée. */
export type HostIndex = { fichier: string; review: Review; revision: number };

export class HostIndexConflict extends Error {}

/** Origine locale de l'hôte PieceMaker, donnée au lancement du serveur du plugin. Absente hors de PieceMaker : le Case index reste alors un .json. */
export function hostIndexOrigin(): string | undefined {
  const origin = process.env.PIECEMAKER_HOST_ORIGIN?.trim();
  return origin ? origin.replace(/\/+$/, '') : undefined;
}

async function call<T>(method: 'GET' | 'PUT' | 'DELETE', project: string, body?: unknown): Promise<T> {
  const origin = hostIndexOrigin()!;
  const query = method === 'PUT' ? '' : `?folder=${encodeURIComponent(project)}`;
  let reply: Response;
  try {
    reply = await fetch(`${origin}/api/piecemaker/local/index-review${query}`, method === 'PUT' ? { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { method });
  } catch (error) {
    throw new UserError(`Case index injoignable : ${error instanceof Error ? error.message : String(error)}`);
  }
  const payload = await reply.json().catch(() => ({})) as T & { error?: string };
  if (reply.status === 409) throw new HostIndexConflict(payload.error ?? 'Case index modifié entre-temps.');
  if (reply.status === 404 && method === 'GET') return { fichier: null, review: null, revision: 0 } as T;
  if (!reply.ok) throw new UserError(payload.error ?? `Case index : erreur ${reply.status}`);
  return payload;
}

/** Le Case index dans SQLite, ou null s'il n'en a pas (ou hors de PieceMaker). */
export async function readHostIndex(project: string): Promise<HostIndex | null> {
  if (!hostIndexOrigin()) return null;
  const stored = await call<{ fichier: string | null; review: Review | null; revision: number }>('GET', project);
  return stored.fichier && stored.review ? { fichier: stored.fichier, review: stored.review, revision: stored.revision } : null;
}

/** Écrit le Case index dans SQLite ; `revision` refuse l'écriture si le Case index a changé depuis la lecture. */
export async function writeHostIndex(project: string, fichier: string, review: Review, revision?: number): Promise<number> {
  const written = await call<{ revision: number }>('PUT', project, { folder: project, fichier, review, ...(revision === undefined ? {} : { revision }) });
  return written.revision;
}

export async function removeHostIndex(project: string): Promise<void> {
  if (hostIndexOrigin()) await call('DELETE', project);
}
