import fsSync from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { getHermesHome } from '@/modules/providers/list/hermes/hermes-home.js';
import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import { normalizeSessionName } from '@/shared/utils.js';

type HermesSessionRow = {
  id: string;
  cwd: string | null;
  title: string | null;
  started_at: number | null;
  ended_at: number | null;
  message_count: number | null;
};

const hermesDbPath = () => path.join(getHermesHome(), 'state.db');

function unixSecondsToIso(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) {
    return new Date().toISOString();
  }
  return new Date(value * 1000).toISOString();
}

function openHermesDatabase(): Database.Database | null {
  if (!fsSync.existsSync(hermesDbPath())) {
    return null;
  }
  return new Database(hermesDbPath(), { readonly: true, fileMustExist: true });
}

export class HermesSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'hermes' as const;

  async synchronize(since?: Date): Promise<number> {
    const db = openHermesDatabase();
    if (!db) {
      return 0;
    }

    try {
      const rows = since
        ? db.prepare(`
            SELECT id, cwd, title, started_at, ended_at, message_count
            FROM sessions
            WHERE COALESCE(ended_at, started_at) >= ?
            ORDER BY COALESCE(ended_at, started_at) ASC
          `).all(Math.floor(since.getTime() / 1000)) as HermesSessionRow[]
        : db.prepare(`
            SELECT id, cwd, title, started_at, ended_at, message_count
            FROM sessions
            ORDER BY COALESCE(ended_at, started_at) ASC
          `).all() as HermesSessionRow[];

      let processed = 0;
      for (const row of rows) {
        if (this.upsertRow(row)) {
          processed += 1;
        }
      }
      return processed;
    } finally {
      db.close();
    }
  }

  async synchronizeFile(filePath: string): Promise<string | null> {
    if (path.resolve(filePath) !== hermesDbPath()) {
      return null;
    }

    const db = openHermesDatabase();
    if (!db) {
      return null;
    }

    try {
      const row = db.prepare(`
        SELECT id, cwd, title, started_at, ended_at, message_count
        FROM sessions
        ORDER BY COALESCE(ended_at, started_at) DESC
        LIMIT 1
      `).get() as HermesSessionRow | undefined;
      return row && this.upsertRow(row) ? row.id : null;
    } finally {
      db.close();
    }
  }

  private upsertRow(row: HermesSessionRow): boolean {
    if (!row.id || !row.cwd) {
      return false;
    }

    sessionsDb.createSession(
      row.id,
      this.provider,
      row.cwd,
      normalizeSessionName(row.title ?? undefined, 'Untitled Hermes Session'),
      unixSecondsToIso(row.started_at),
      unixSecondsToIso(row.ended_at ?? row.started_at),
      hermesDbPath(),
    );
    return true;
  }
}
