const STORAGE_PREFIX = 'piecemaker:mappingReady:';

const cache = new Map<string, boolean>();
const listeners = new Set<() => void>();

function readFromStorage(caseRoot: string): boolean | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + caseRoot);
    return raw === null ? null : raw === '1';
  } catch {
    return null;
  }
}

function writeToStorage(caseRoot: string, ready: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + caseRoot, ready ? '1' : '0');
  } catch {
    // best-effort persistence only
  }
}

/**
 * Shared cache for "is this case's anonymization mapping ready" — a single
 * boolean per case root path. Populated by CaseMappingSetup.tsx at the point
 * where it already loads the case overview; read reactively elsewhere (e.g.
 * the sidebar project row) via useSyncExternalStore, so nothing else needs to
 * fetch or poll a separate source of truth for the same fact.
 */
export function getMappingReady(caseRoot: string): boolean {
  const cached = cache.get(caseRoot);
  if (cached !== undefined) return cached;

  const stored = readFromStorage(caseRoot);
  if (stored !== null) {
    cache.set(caseRoot, stored);
    return stored;
  }

  return false;
}

export function setMappingReady(caseRoot: string, ready: boolean): void {
  if (cache.get(caseRoot) === ready) return;
  cache.set(caseRoot, ready);
  writeToStorage(caseRoot, ready);
  listeners.forEach((listener) => listener());
}

export function subscribeMappingReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
