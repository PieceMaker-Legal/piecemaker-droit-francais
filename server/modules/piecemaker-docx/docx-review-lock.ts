import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

export async function withDocxReviewLock<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(directory, { recursive: true });
  const lock = path.join(directory, 'operation.lock');
  const deadline = Date.now() + 10000;
  for (;;) {
    try { await mkdir(lock); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() - (await stat(lock).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs > 120000) await rm(lock, { recursive: true, force: true });
      if (Date.now() >= deadline) throw new Error('Une autre opération Word est en cours. Réessayez.');
      await setTimeout(25);
    }
  }
  try { return await operation(); }
  finally { await rm(lock, { recursive: true, force: true }); }
}
