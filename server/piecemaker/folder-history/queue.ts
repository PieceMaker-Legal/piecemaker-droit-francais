type Task = { key: string; run: () => Promise<void> };

export type GitQueue = ReturnType<typeof createGitQueue>;

export function createGitQueue() {
  const pending: Task[] = [];
  const pendingKeys = new Set<string>();
  const idleWaiters: Array<() => void> = [];
  let running = false;

  const drain = async () => {
    if (running) return;
    running = true;
    while (pending.length > 0) {
      const task = pending.shift()!;
      pendingKeys.delete(task.key);
      try {
        await task.run();
      } catch (error) {
        console.error('[PieceMaker] Historique du dossier :', error);
      }
    }
    running = false;
    idleWaiters.splice(0).forEach((resolve) => resolve());
  };

  return {
    push(key: string, run: () => Promise<void>) {
      if (pendingKeys.has(key)) return;
      pendingKeys.add(key);
      pending.push({ key, run });
      void drain();
    },
    idle(): Promise<void> {
      if (!running && pending.length === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
  };
}
