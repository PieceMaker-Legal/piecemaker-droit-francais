import assert from 'node:assert/strict';
import test from 'node:test';

import { sessionsDb } from '@/modules/database/index.js';
import type { FetchHistoryResult } from '@/shared/types.js';

import { createTimesheetService } from './service.js';
import type { TimesheetEntry } from './store.js';

type Session = ReturnType<typeof sessionsDb.getAllSessions>[number];

function makeSession(id: string, projectPath = '/dossier') {
  return {
    session_id: id,
    provider: 'claude',
    provider_session_id: id,
    project_path: projectPath,
    jsonl_path: null,
    custom_name: 'Session de test',
    created_at: '2026-09-01T09:00:00.000Z',
    updated_at: '2026-09-01T10:00:00.000Z',
  } as Session;
}

function makeStore() {
  const entries = new Map<string, TimesheetEntry>();
  return {
    entries,
    upsert(entry: TimesheetEntry) { entries.set(entry.sessionId, entry); },
    findBySessionId(sessionId: string) { return entries.get(sessionId) ?? null; },
    list(projectId?: string) { return [...entries.values()].filter((entry) => !projectId || entry.projectId === projectId); },
  };
}

test('extrait le temps actif plafonné et la dernière conclusion visible', async () => {
  const store = makeStore();
  const session = makeSession('session-1');
  const service = createTimesheetService(store, {
    sessions: {
      getAllSessions: () => [session],
      getSessionsByProjectPath: () => [session],
    },
    projects: {
      getProjectById: () => ({ project_id: 'project-1', project_path: '/dossier', custom_project_name: 'Dossier', isStarred: 0, isArchived: 0 }),
      getProjectPath: () => ({ project_id: 'project-1', project_path: '/dossier', custom_project_name: 'Dossier', isStarred: 0, isArchived: 0 }),
    },
    history: {
      fetchHistory: async () => ({
        messages: [
          { id: '1', sessionId: 'session-1', timestamp: '2026-09-01T09:00:00.000Z', provider: 'claude', kind: 'text', role: 'user', content: 'Question' },
          { id: '2', sessionId: 'session-1', timestamp: '2026-09-01T09:05:00.000Z', provider: 'claude', kind: 'text', role: 'assistant', content: 'Première réponse' },
          { id: '3', sessionId: 'session-1', timestamp: '2026-09-01T10:00:00.000Z', provider: 'claude', kind: 'text', role: 'assistant', content: 'Conclusion finale' },
        ],
        total: 3,
        hasMore: false,
        offset: 0,
        limit: null,
      }),
    },
  });

  const result = await service.refresh({ scope: 'all' });
  assert.equal(result.refreshedCount, 1);
  assert.equal(result.entries[0].elapsedSeconds, 3600);
  assert.equal(result.entries[0].activeSeconds, 1200);
  assert.equal(result.entries[0].conclusion, 'Conclusion finale');
  assert.equal(result.entries[0].conclusionAt, '2026-09-01T10:00:00.000Z');
});

test('coalesce les actualisations identiques', async () => {
  const store = makeStore();
  const session = makeSession('session-2');
  let resolveHistory: ((value: FetchHistoryResult) => void) | undefined;
  const service = createTimesheetService(store, {
    sessions: { getAllSessions: () => [session], getSessionsByProjectPath: () => [session] },
    projects: {
      getProjectById: () => ({ project_id: 'project-1', project_path: '/dossier', custom_project_name: null, isStarred: 0, isArchived: 0 }),
      getProjectPath: () => ({ project_id: 'project-1', project_path: '/dossier', custom_project_name: null, isStarred: 0, isArchived: 0 }),
    },
    history: {
      fetchHistory: () => new Promise<FetchHistoryResult>((resolve) => {
        resolveHistory = resolve;
      }),
    },
  });

  const first = service.refresh({ scope: 'all' });
  const second = service.refresh({ scope: 'all' });
  assert.equal(first, second);
  resolveHistory?.({ messages: [], total: 0, hasMore: false, offset: 0, limit: null });
  await first;
});
