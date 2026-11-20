import { RUNNABLE_PROVIDERS } from '@/modules/piecemaker-orchestrateur/index.js';

type Status = { installed: boolean; authenticated: boolean };

export function createOrchestratorProviderStatuses(
  cliStatus: (provider: 'claude' | 'codex') => Promise<Status>,
  mistralStatus: (userId: number) => { authenticated: boolean },
) {
  const cache = new Map<string, { until: number; status: Promise<Status> }>();
  return (userId: number | null) => Promise.all(RUNNABLE_PROVIDERS.map(async provider => {
    try {
      if (provider === 'mistral') return { provider, installed: true, authenticated: userId !== null && mistralStatus(userId).authenticated };
      let entry = cache.get(provider);
      if (!entry || entry.until <= Date.now()) {
        const status = cliStatus(provider);
        entry = { until: Infinity, status };
        cache.set(provider, entry);
        const pending = entry;
        status.then(result => { pending.until = result.authenticated ? Date.now() + 60_000 : 0; }, () => { cache.delete(provider); });
      }
      const { installed, authenticated } = await entry.status;
      return { provider, installed, authenticated };
    } catch {
      return { provider, installed: false, authenticated: false };
    }
  }));
}
