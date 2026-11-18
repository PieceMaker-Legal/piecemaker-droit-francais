import { classifiedChange } from '../client/sorting.js';
import type { CasePiece } from '../client/sorting.js';
import { UserError } from './paths.js';
import { markApplied, readReview } from './reviews.js';

const queues = new Map<string, Promise<void>>();

export function assertHostOrigin(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new UserError('Origine du serveur PieceMaker invalide.');
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/') throw new UserError('Origine du serveur PieceMaker invalide.');
  return url.origin;
}

async function local<T>(origin: string, route: string, body?: unknown): Promise<T> {
  const reply = await fetch(`${origin}/api/piecemaker/local${route}`, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await reply.json().catch(() => ({})) as T & { error?: string };
  if (!reply.ok) throw new Error(payload.error ?? `erreur ${reply.status}`);
  return payload;
}

async function moveRow(origin: string, project: string, file: string, rowId: string): Promise<void> {
  const review = await readReview(project, file);
  const row = review.rows.find((entry) => entry.id === rowId);
  if (!row) return;
  const { pieces } = await local<{ pieces: CasePiece[] }>(origin, `/pieces?folder=${encodeURIComponent(project)}`);
  const change = classifiedChange(review, row, pieces);
  if (!change) return;
  const moved = await local<{ current: string; markdown: string | null }>(origin, '/rename', { folder: project, path: change.piece, directory: change.directory });
  await markApplied(project, file, rowId, moved.current, moved.markdown);
}

export function sortRow(origin: string, project: string, file: string, rowId: string): Promise<void> {
  const next = (queues.get(project) ?? Promise.resolve()).then(() => moveRow(origin, project, file, rowId));
  queues.set(project, next.catch(() => undefined));
  return next;
}
