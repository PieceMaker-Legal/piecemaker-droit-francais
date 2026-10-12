import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { Draft, RowRequest, TemplateColumn } from '../shared.js';
import { assertProject, PLUGIN_HOME, UserError, writeFileAtomic } from './paths.js';

const DRAFTS_FILE = path.join(PLUGIN_HOME, 'drafts.json');

export function readDrafts(file = DRAFTS_FILE): Draft[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { drafts?: unknown };
    return Array.isArray(parsed.drafts) ? parsed.drafts as Draft[] : [];
  } catch {
    return [];
  }
}

function saveDrafts(drafts: Draft[], file: string): void {
  writeFileAtomic(file, `${JSON.stringify({ version: 1, drafts }, null, 2)}\n`);
}

export function listDrafts(projects: string[], file = DRAFTS_FILE): Draft[] {
  const wanted = new Set(projects);
  return readDrafts(file).filter((draft) => wanted.has(draft.project));
}

export function upsertDraft(value: unknown, file = DRAFTS_FILE, project = assertProject): Draft {
  const input = (value ?? {}) as Record<string, unknown>;
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 120) : '';
  if (!title) throw new UserError('Donnez un nom au tableau.');
  const drafts = readDrafts(file);
  const id = typeof input.id === 'string' && /^[\w-]{1,80}$/.test(input.id) ? input.id : randomUUID();
  const previous = drafts.find((draft) => draft.id === id);
  const now = new Date().toISOString();
  const draft: Draft = {
    id,
    project: project(input.project),
    title,
    templateName: typeof input.templateName === 'string' ? input.templateName.slice(0, 120) : '',
    columns: Array.isArray(input.columns) ? input.columns as TemplateColumn[] : [],
    rows: Array.isArray(input.rows) ? input.rows as RowRequest[] : [],
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  saveDrafts([...drafts.filter((entry) => entry.id !== id), draft], file);
  return draft;
}

export function deleteDraft(id: unknown, file = DRAFTS_FILE): void {
  const drafts = readDrafts(file);
  const next = drafts.filter((draft) => draft.id !== id);
  if (next.length !== drafts.length) saveDrafts(next, file);
}
