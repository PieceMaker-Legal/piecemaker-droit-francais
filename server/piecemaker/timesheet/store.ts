import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

export type TimesheetEntry = {
  sessionId: string;
  provider: string;
  projectId: string | null;
  projectPath: string;
  projectName: string;
  sessionName: string;
  startedAt: string | null;
  endedAt: string | null;
  elapsedSeconds: number;
  activeSeconds: number;
  conclusion: string | null;
  conclusionAt: string | null;
  transcriptFingerprint: string;
  extractedAt: string;
};

type TimesheetEntryRow = {
  session_id: string;
  provider: string;
  project_id: string | null;
  project_path: string;
  project_name: string;
  session_name: string;
  started_at: string | null;
  ended_at: string | null;
  elapsed_seconds: number;
  active_seconds: number;
  conclusion: string | null;
  conclusion_at: string | null;
  transcript_fingerprint: string;
  extracted_at: string;
};

function toEntry(row: TimesheetEntryRow): TimesheetEntry {
  return {
    sessionId: row.session_id,
    provider: row.provider,
    projectId: row.project_id,
    projectPath: row.project_path,
    projectName: row.project_name,
    sessionName: row.session_name,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    elapsedSeconds: row.elapsed_seconds,
    activeSeconds: row.active_seconds,
    conclusion: row.conclusion,
    conclusionAt: row.conclusion_at,
    transcriptFingerprint: row.transcript_fingerprint,
    extractedAt: row.extracted_at,
  };
}

export function createTimesheetStore(homeDir: string) {
  const directory = path.join(homeDir, 'timesheet');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const databasePath = path.join(directory, 'timesheet.sqlite');
  const database = new Database(databasePath);
  fs.chmodSync(databasePath, 0o600);
  database.pragma('journal_mode = WAL');
  database.exec(`
    CREATE TABLE IF NOT EXISTS timesheet_sessions (
      session_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      project_id TEXT,
      project_path TEXT NOT NULL,
      project_name TEXT NOT NULL,
      session_name TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT,
      elapsed_seconds INTEGER NOT NULL,
      active_seconds INTEGER NOT NULL,
      conclusion TEXT,
      conclusion_at TEXT,
      transcript_fingerprint TEXT NOT NULL,
      extracted_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS timesheet_project_date
      ON timesheet_sessions(project_id, started_at);
    CREATE INDEX IF NOT EXISTS timesheet_date
      ON timesheet_sessions(started_at);
  `);

  const upsert = database.prepare(`
    INSERT INTO timesheet_sessions (
      session_id, provider, project_id, project_path, project_name, session_name,
      started_at, ended_at, elapsed_seconds, active_seconds, conclusion,
      conclusion_at, transcript_fingerprint, extracted_at
    ) VALUES (
      @sessionId, @provider, @projectId, @projectPath, @projectName, @sessionName,
      @startedAt, @endedAt, @elapsedSeconds, @activeSeconds, @conclusion,
      @conclusionAt, @transcriptFingerprint, @extractedAt
    )
    ON CONFLICT(session_id) DO UPDATE SET
      provider = excluded.provider,
      project_id = excluded.project_id,
      project_path = excluded.project_path,
      project_name = excluded.project_name,
      session_name = excluded.session_name,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      elapsed_seconds = excluded.elapsed_seconds,
      active_seconds = excluded.active_seconds,
      conclusion = excluded.conclusion,
      conclusion_at = excluded.conclusion_at,
      transcript_fingerprint = excluded.transcript_fingerprint,
      extracted_at = excluded.extracted_at
  `);
  const findBySessionId = database.prepare('SELECT * FROM timesheet_sessions WHERE session_id = ?');
  const listAll = database.prepare('SELECT * FROM timesheet_sessions ORDER BY datetime(started_at) DESC, session_id DESC');
  const listByProject = database.prepare('SELECT * FROM timesheet_sessions WHERE project_id = ? ORDER BY datetime(started_at) DESC, session_id DESC');

  return {
    databasePath,
    upsert(entry: TimesheetEntry): void {
      upsert.run(entry);
    },
    findBySessionId(sessionId: string): TimesheetEntry | null {
      const row = findBySessionId.get(sessionId) as TimesheetEntryRow | undefined;
      return row ? toEntry(row) : null;
    },
    list(projectId?: string): TimesheetEntry[] {
      const rows = (projectId ? listByProject.all(projectId) : listAll.all()) as TimesheetEntryRow[];
      return rows.map(toEntry);
    },
    close(): void {
      database.close();
    },
  };
}
