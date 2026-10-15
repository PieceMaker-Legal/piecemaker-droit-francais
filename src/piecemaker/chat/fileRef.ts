import { authenticatedFetch } from '@/shared/api';

const NEGATIVE_TTL_MS = 3000;
const BATCH_SIZE = 200;

type Waiter = (path: string | null) => void;

const cache = new Map<string, { path: string | null; at: number }>();
const queues = new Map<string, Map<string, Waiter[]>>();
const inflight = new Map<string, Promise<string | null>>();
let flushScheduled = false;
let activeProjectId = '';

/** Dossier ouvert, publié par `useSelectedDossierRegistration` : les chemins relatifs s'y résolvent. */
export function setActiveProjectId(projectId: string | null | undefined): void {
  activeProjectId = projectId ?? '';
}

const cacheKey = (projectId: string, ref: string) => `${projectId}\u0000${ref}`;

/** Résultat connu : chemin réel, `null` si introuvable, `undefined` s'il faut demander au serveur. */
export function cachedFileRef(ref: string, projectId = activeProjectId): string | null | undefined {
  const entry = cache.get(cacheKey(projectId, ref));
  if (!entry || (entry.path === null && Date.now() - entry.at > NEGATIVE_TTL_MS)) return undefined;
  return entry.path;
}

async function send(projectId: string, refs: string[], piece = false): Promise<Array<string | null>> {
  try {
    const response = await authenticatedFetch('/api/piecemaker/file-links/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, refs, ...(piece ? { piece: true } : {}) }),
    });
    const data = response.ok ? await response.json() : null;
    return Array.isArray(data?.paths) ? data.paths : refs.map(() => null);
  } catch {
    return refs.map(() => null);
  }
}

async function flush() {
  flushScheduled = false;
  const batches = [...queues];
  queues.clear();
  await Promise.all(batches.map(async ([projectId, waiters]) => {
    const refs = [...waiters.keys()];
    for (let start = 0; start < refs.length; start += BATCH_SIZE) {
      const chunk = refs.slice(start, start + BATCH_SIZE);
      const paths = await send(projectId, chunk);
      chunk.forEach((ref, index) => {
        const path = typeof paths[index] === 'string' ? paths[index] : null;
        cache.set(cacheKey(projectId, ref), { path, at: Date.now() });
        for (const resolve of waiters.get(ref) ?? []) resolve(path);
      });
    }
  }));
}

/**
 * Chemin réel d'un fichier cité, vérifié par le serveur (`null` s'il n'existe
 * pas). Les demandes d'un même tour sont envoyées en un seul lot.
 */
export function resolveFileRef(ref: string, options: { fresh?: boolean; projectId?: string } = {}): Promise<string | null> {
  const projectId = options.projectId ?? activeProjectId;
  const key = cacheKey(projectId, ref);
  if (!options.fresh) {
    const known = cachedFileRef(ref, projectId);
    if (known !== undefined) return Promise.resolve(known);
    const pending = inflight.get(key);
    if (pending) return pending;
  }
  const request = new Promise<string | null>((resolve) => {
    const waiters = queues.get(projectId) ?? new Map<string, Waiter[]>();
    waiters.set(ref, [...(waiters.get(ref) ?? []), resolve]);
    queues.set(projectId, waiters);
    if (!flushScheduled) {
      flushScheduled = true;
      queueMicrotask(() => void flush());
    }
  }).finally(() => {
    if (inflight.get(key) === request) inflight.delete(key);
  });
  inflight.set(key, request);
  return request;
}

export async function resolvePieceRef(ref: string, projectId = activeProjectId): Promise<string | null> {
  const paths = await send(projectId, [ref], true);
  return typeof paths[0] === 'string' ? paths[0] : null;
}
