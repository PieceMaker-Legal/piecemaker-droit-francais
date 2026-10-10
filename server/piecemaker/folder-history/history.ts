import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';

import { isIgnoredPath } from './exclude.js';
import { commitAll, ensureRepo, hasPieceMakerExclude } from './git.js';
import type { Identity } from './identity.js';
import { manualMessage, turnMessage } from './message.js';
import { createGitQueue } from './queue.js';

export type FolderTurn = { cwd: string; request: string; conclusion: string; aborted: boolean; author: Identity };

export type FolderHistory = ReturnType<typeof createFolderHistory>;

const IDLE_DELAY_MS = 120_000;
const CATCH_UP_DELAY_MS = 30_000;

export function createFolderHistory(options: { idleDelayMs?: number; catchUpDelayMs?: number } = {}) {
  const idleDelayMs = options.idleDelayMs ?? IDLE_DELAY_MS;
  const queue = createGitQueue();
  const ready = new Map<string, boolean>();
  const activeTurns = new Map<string, number>();
  const idleTimers = new Map<string, NodeJS.Timeout>();
  const watchers = new Map<string, FSWatcher>();
  let turnSequence = 0;

  const prepare = async (cwd: string) => {
    const known = ready.get(cwd);
    if (known !== undefined) return known;
    const prepared = await ensureRepo(cwd);
    ready.set(cwd, prepared);
    return prepared;
  };

  const queueManual = (cwd: string, onlyExisting = false) => queue.push(`manual:${cwd}`, async () => {
    if (onlyExisting && !(await hasPieceMakerExclude(cwd))) return;
    if (await prepare(cwd)) await commitAll(cwd, manualMessage);
  });

  const cancelIdleTimer = (cwd: string) => {
    clearTimeout(idleTimers.get(cwd));
    idleTimers.delete(cwd);
  };

  const scheduleManual = (cwd: string) => {
    if ((activeTurns.get(cwd) ?? 0) > 0) return;
    cancelIdleTimer(cwd);
    const timer = setTimeout(() => {
      idleTimers.delete(cwd);
      queueManual(cwd);
    }, idleDelayMs);
    timer.unref();
    idleTimers.set(cwd, timer);
  };

  const watchFolder = (cwd: string) => {
    if (watchers.has(cwd)) return;
    try {
      const watcher = watch(cwd, { recursive: true, persistent: false }, (_event, filename) => {
        if (filename && isIgnoredPath(String(filename))) return;
        scheduleManual(cwd);
      });
      watcher.on('error', () => {
        watcher.close();
        watchers.delete(cwd);
      });
      watchers.set(cwd, watcher);
    } catch {}
  };

  const catchUp = setTimeout(() => {
    for (const cwd of watchers.keys()) queueManual(cwd, true);
  }, options.catchUpDelayMs ?? CATCH_UP_DELAY_MS);
  catchUp.unref();

  return {
    begin(folder: string) {
      if (!folder) return;
      const cwd = path.resolve(folder);
      activeTurns.set(cwd, (activeTurns.get(cwd) ?? 0) + 1);
      cancelIdleTimer(cwd);
      queueManual(cwd);
    },
    end(turn: FolderTurn) {
      if (!turn.cwd) return;
      const cwd = path.resolve(turn.cwd);
      const remaining = (activeTurns.get(cwd) ?? 1) - 1;
      if (remaining > 0) activeTurns.set(cwd, remaining);
      else activeTurns.delete(cwd);
      if (turn.aborted) {
        scheduleManual(cwd);
        return;
      }
      queue.push(`turn:${cwd}:${++turnSequence}`, async () => {
        if (await prepare(cwd)) await commitAll(cwd, () => turnMessage(turn.request, turn.conclusion), turn.author);
      });
    },
    syncFolders(folders: string[]) {
      const wanted = new Set(folders.map((folder) => path.resolve(folder)));
      for (const [cwd, watcher] of watchers) {
        if (wanted.has(cwd)) continue;
        watcher.close();
        watchers.delete(cwd);
      }
      for (const cwd of wanted) watchFolder(cwd);
    },
    idle: () => queue.idle(),
    close() {
      clearTimeout(catchUp);
      for (const timer of idleTimers.values()) clearTimeout(timer);
      idleTimers.clear();
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
  };
}
