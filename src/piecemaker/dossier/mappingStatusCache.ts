const cache = new Map<string, boolean>();
const listeners = new Set<() => void>();

export function getAnonymizationComplete(caseRoot: string): boolean {
  const cached = cache.get(caseRoot);
  if (cached !== undefined) return cached;
  return false;
}

export function setAnonymizationComplete(caseRoot: string, complete: boolean): void {
  if (cache.get(caseRoot) === complete) return;
  cache.set(caseRoot, complete);
  listeners.forEach((listener) => listener());
}

export function subscribeAnonymizationStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
