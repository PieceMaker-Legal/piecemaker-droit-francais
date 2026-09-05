/**
 * HTTP client for the PieceMaker backend mounted at `/api/piecemaker`
 * (see `server/piecemaker/router.cjs`).
 *
 * Every call goes through CloudCLI's `authenticatedFetch` so the bearer token and
 * session refresh behave exactly like the rest of the app. Routes keep the paths
 * of the standalone PieceMaker administration panel, minus its `/api/admin` prefix.
 */

import { authenticatedFetch } from '@/shared/api';

const BASE = '/api/piecemaker';

export class PieceMakerApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'PieceMakerApiError';
    this.status = status;
  }
}

type QueryValue = string | number | boolean | null | undefined;

function withQuery(path: string, params?: Record<string, QueryValue>): string {
  if (!params) return `${BASE}${path}`;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return `${BASE}${path}${serialized ? `?${serialized}` : ''}`;
}

async function unwrap<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let payload: unknown = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    // A non-JSON body means the request never reached the router (proxy, HTML error page).
    if (!response.ok) throw new PieceMakerApiError(raw.slice(0, 200) || response.statusText, response.status);
    throw new PieceMakerApiError('Réponse illisible du serveur PieceMaker.', response.status);
  }
  if (!response.ok) {
    const message = (payload as { error?: string } | null)?.error;
    throw new PieceMakerApiError(message || `Erreur ${response.status}`, response.status);
  }
  return payload as T;
}

/** GET a JSON endpoint. */
export function pmGet<T>(path: string, params?: Record<string, QueryValue>, signal?: AbortSignal): Promise<T> {
  return authenticatedFetch(withQuery(path, params), { signal }).then((response) => unwrap<T>(response));
}

/** POST/PUT/PATCH/DELETE a JSON endpoint. `body` is omitted when undefined. */
export function pmSend<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  params?: Record<string, QueryValue>,
): Promise<T> {
  return authenticatedFetch(withQuery(path, params), {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).then((response) => unwrap<T>(response));
}

export const pmPost = <T,>(path: string, body?: unknown, params?: Record<string, QueryValue>) =>
  pmSend<T>('POST', path, body, params);
export const pmPut = <T,>(path: string, body?: unknown, params?: Record<string, QueryValue>) =>
  pmSend<T>('PUT', path, body, params);
export const pmDelete = <T,>(path: string, body?: unknown, params?: Record<string, QueryValue>) =>
  pmSend<T>('DELETE', path, body, params);

/** POST a raw binary body — used to upload a skill asset, which the backend reads from `req.body`. */
export function pmPostBinary<T>(
  path: string,
  data: ArrayBuffer | Blob,
  params?: Record<string, QueryValue>,
): Promise<T> {
  return authenticatedFetch(withQuery(path, params), {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: data as BodyInit,
  }).then((response) => unwrap<T>(response));
}

/** Absolute URL of a skill asset served by the backend, for `<img src>`. */
export const pmAssetUrl = (relativePath: string) => withQuery('/asset', { path: relativePath });

export { BASE as PIECEMAKER_API_BASE };
