export type LegalCodeStart = { projectId: string; trigger: number };

let pending: LegalCodeStart | null = null;
const listeners = new Set<() => void>();

function setPending(next: LegalCodeStart | null) {
  pending = next;
  listeners.forEach((listener) => listener());
}

export function startLegalCode(projectId: string, trigger: number): void {
  setPending({ projectId, trigger });
}

export function cancelLegalCode(): void {
  if (pending) setPending(null);
}

export function readLegalCodeStart(): LegalCodeStart | null {
  return pending;
}

export function subscribeToLegalCode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function legalCodeSendOptions(projectId: string | undefined, isNewSession: boolean): { legalCode?: true } {
  if (!isNewSession || !projectId || pending?.projectId !== projectId) return {};
  setPending(null);
  return { legalCode: true };
}
