import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/index.js';
import type { NormalizedMessage } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import type { TimesheetEntry } from './store.js';

export type TimesheetScope = 'all' | 'project';

export type TimesheetQuery = {
  scope: TimesheetScope;
  projectId?: string;
};

export type TimesheetRefreshError = {
  sessionId: string;
  code: 'EXTRACTION_FAILED';
};

export type TimesheetRefreshResult = {
  entries: TimesheetEntry[];
  refreshedAt: string;
  refreshedCount: number;
  skippedCount: number;
  errors: TimesheetRefreshError[];
};

type SessionRecord = ReturnType<typeof sessionsDb.getAllSessions>[number];

type TimesheetStore = {
  upsert(entry: TimesheetEntry): void;
  findBySessionId(sessionId: string): TimesheetEntry | null;
  list(projectId?: string): TimesheetEntry[];
};

type TimesheetDependencies = {
  sessions: Pick<typeof sessionsDb, 'getAllSessions' | 'getSessionsByProjectPath'>;
  projects: Pick<typeof projectsDb, 'getProjectById' | 'getProjectPath'>;
  history: Pick<typeof sessionsService, 'fetchHistory'>;
};

const DEFAULT_DEPENDENCIES: TimesheetDependencies = {
  sessions: sessionsDb,
  projects: projectsDb,
  history: sessionsService,
};

const MAX_ACTIVE_GAP_SECONDS = 15 * 60;

function projectDisplayName(projectPath: string, customName: string | null | undefined): string {
  const name = customName?.trim();
  return name || path.basename(projectPath) || projectPath || 'Sans dossier';
}

function messageText(message: NormalizedMessage): string {
  if (message.kind !== 'text' || message.role !== 'assistant') return '';
  const text = message.content ?? message.displayText ?? message.text ?? '';
  return typeof text === 'string' ? text.trim() : '';
}

function validTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function fingerprint(session: SessionRecord, dependencies: TimesheetDependencies): string {
  let fileState = null;
  if (session.jsonl_path) {
    try {
      const stats = fs.statSync(session.jsonl_path);
      fileState = { size: stats.size, modified: stats.mtimeMs };
    } catch {
      fileState = { missing: true };
    }
  }
  const project = session.project_path ? dependencies.projects.getProjectPath(session.project_path) : null;
  return createHash('sha256').update(JSON.stringify({
    sessionId: session.session_id,
    provider: session.provider,
    providerSessionId: session.provider_session_id,
    jsonlPath: session.jsonl_path,
    customName: session.custom_name,
    projectId: project?.project_id ?? null,
    projectName: project?.custom_project_name ?? null,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    fileState,
  })).digest('hex');
}

function validateProjectId(projectId: unknown): string {
  if (typeof projectId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(projectId)) {
    throw new AppError('projectId is required and must be a valid identifier.', {
      code: 'TIMESHEET_PROJECT_ID_INVALID',
      statusCode: 400,
    });
  }
  return projectId;
}

export function parseTimesheetQuery(input: { scope?: unknown; projectId?: unknown }): TimesheetQuery {
  if (input.scope !== 'all' && input.scope !== 'project') {
    throw new AppError('scope must be "all" or "project".', {
      code: 'TIMESHEET_SCOPE_INVALID',
      statusCode: 400,
    });
  }
  if (input.scope === 'all') {
    if (input.projectId !== undefined) {
      throw new AppError('projectId is only valid with project scope.', {
        code: 'TIMESHEET_PROJECT_ID_UNEXPECTED',
        statusCode: 400,
      });
    }
    return { scope: 'all' };
  }
  return { scope: 'project', projectId: validateProjectId(input.projectId) };
}

export function createTimesheetService(
  store: TimesheetStore,
  dependencies: TimesheetDependencies = DEFAULT_DEPENDENCIES,
) {
  const refreshes = new Map<string, Promise<TimesheetRefreshResult>>();

  function resolveProject(projectId: string) {
    const project = dependencies.projects.getProjectById(projectId);
    if (!project) {
      throw new AppError('The requested project was not found.', {
        code: 'TIMESHEET_PROJECT_NOT_FOUND',
        statusCode: 404,
      });
    }
    return project;
  }

  function sessionsFor(query: TimesheetQuery): SessionRecord[] {
    if (query.scope === 'all') return dependencies.sessions.getAllSessions();
    const project = resolveProject(query.projectId as string);
    return dependencies.sessions.getSessionsByProjectPath(project.project_path);
  }

  async function refreshNow(query: TimesheetQuery): Promise<TimesheetRefreshResult> {
    const sessions = sessionsFor(query);
    let refreshedCount = 0;
    let skippedCount = 0;
    const errors: TimesheetRefreshError[] = [];

    for (const session of sessions) {
      const entryFingerprint = fingerprint(session, dependencies);
      const existing = store.findBySessionId(session.session_id);
      if (existing?.transcriptFingerprint === entryFingerprint) {
        skippedCount += 1;
        continue;
      }
      try {
        const history = await dependencies.history.fetchHistory(session.session_id, { limit: null, offset: 0 });
        const summary = summarizeHistoryWithDependencies(session, history.messages, entryFingerprint, dependencies);
        store.upsert({ ...summary, extractedAt: new Date().toISOString() });
        refreshedCount += 1;
      } catch {
        errors.push({ sessionId: session.session_id, code: 'EXTRACTION_FAILED' });
      }
    }

    return {
      entries: store.list(query.scope === 'project' ? query.projectId : undefined),
      refreshedAt: new Date().toISOString(),
      refreshedCount,
      skippedCount,
      errors,
    };
  }

  function refresh(query: TimesheetQuery): Promise<TimesheetRefreshResult> {
    const key = query.scope === 'all' ? 'all' : `project:${query.projectId}`;
    const current = refreshes.get(key);
    if (current) return current;
    const pending = refreshNow(query);
    refreshes.set(key, pending);
    void pending.then(() => {
      if (refreshes.get(key) === pending) refreshes.delete(key);
    }, () => {
      if (refreshes.get(key) === pending) refreshes.delete(key);
    });
    return pending;
  }

  return {
    list(query: TimesheetQuery): TimesheetEntry[] {
      if (query.scope === 'project') resolveProject(query.projectId as string);
      return store.list(query.scope === 'project' ? query.projectId : undefined);
    },
    refresh,
  };
}

function summarizeHistoryWithDependencies(
  session: SessionRecord,
  messages: NormalizedMessage[],
  entryFingerprint: string,
  dependencies: TimesheetDependencies,
): Omit<TimesheetEntry, 'extractedAt'> {
  const events = messages
    .map((message) => ({ message, timestamp: validTimestamp(message.timestamp) }))
    .filter((event): event is { message: NormalizedMessage; timestamp: string } => Boolean(event.timestamp))
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const fallbackStartedAt = validTimestamp(session.created_at);
  const fallbackEndedAt = validTimestamp(session.updated_at) ?? fallbackStartedAt;
  const startedAt = events[0]?.timestamp ?? fallbackStartedAt;
  const endedAt = events.at(-1)?.timestamp ?? fallbackEndedAt;
  const elapsedSeconds = startedAt && endedAt ? Math.max(0, Math.floor((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)) : 0;
  let activeSeconds = 0;
  for (let index = 1; index < events.length; index += 1) {
    const gapSeconds = Math.max(0, Math.floor((Date.parse(events[index].timestamp) - Date.parse(events[index - 1].timestamp)) / 1000));
    activeSeconds += Math.min(gapSeconds, MAX_ACTIVE_GAP_SECONDS);
  }
  const conclusionEvent = [...events].reverse().find((event) => Boolean(messageText(event.message)));
  const projectPath = session.project_path ?? '';
  const project = projectPath ? dependencies.projects.getProjectPath(projectPath) : null;
  return {
    sessionId: session.session_id,
    provider: session.provider,
    projectId: project?.project_id ?? null,
    projectPath,
    projectName: projectDisplayName(projectPath, project?.custom_project_name),
    sessionName: session.custom_name?.trim() || session.session_id,
    startedAt,
    endedAt,
    elapsedSeconds,
    activeSeconds,
    conclusion: conclusionEvent ? messageText(conclusionEvent.message) : null,
    conclusionAt: conclusionEvent?.timestamp ?? null,
    transcriptFingerprint: entryFingerprint,
  };
}
