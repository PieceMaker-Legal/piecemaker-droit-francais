import fs from 'node:fs';
import path from 'node:path';

import type { Cell, Review, ReviewRow } from '../shared.js';
import { reviewDirectory } from './paths.js';
import { missingCell, parseCells, systemPrompt, userPrompt } from './prompt.js';
import type { PromptDocument } from './prompt.js';
import { readReview, reviewKey, updateReview } from './reviews.js';
import { runSession } from './sessions.js';

export const INLINE_CHARACTER_LIMIT = 150_000;

type Job = {
  project: string;
  file: string;
  queue: string[];
  workers: number;
  controller: AbortController;
  environment: NodeJS.ProcessEnv;
};

const jobs = new Map<string, Job>();

export function isRunning(project: string, file: string): boolean {
  return jobs.has(reviewKey(project, file));
}

export function rowMode(row: ReviewRow): 'inline' | 'path' {
  return row.documents.reduce((total, document) => total + document.chars, 0) <= INLINE_CHARACTER_LIMIT ? 'inline' : 'path';
}

function promptDocuments(project: string, row: ReviewRow, mode: 'inline' | 'path'): PromptDocument[] {
  return row.documents.map((document) => {
    const absolute = path.join(reviewDirectory(project), ...document.copy.split('/'));
    return {
      name: document.source,
      path: absolute,
      content: mode === 'inline' ? fs.readFileSync(absolute, 'utf8') : null,
    };
  });
}

function completeCells(review: Review, parsed: Map<number, Cell>): Record<string, Cell> {
  return Object.fromEntries(review.columns.map((column) => [String(column.index), parsed.get(column.index) ?? missingCell()]));
}

async function runRow(job: Job, rowId: string): Promise<void> {
  const review = readReview(job.project, job.file);
  const row = review.rows.find((entry) => entry.id === rowId);
  if (!row) return;
  const mode = rowMode(row);
  await updateReview(job.project, job.file, (current) => {
    const target = current.rows.find((entry) => entry.id === rowId);
    if (!target) return;
    Object.assign(target, { status: 'running', mode, startedAt: new Date().toISOString(), finishedAt: undefined, error: undefined });
  });
  try {
    const output = await runSession({
      provider: review.provider,
      model: review.model,
      mode,
      system: systemPrompt(mode),
      user: userPrompt(row.label, promptDocuments(job.project, row, mode), review.columns),
      readableDirectory: path.join(reviewDirectory(job.project), 'docs'),
      environment: job.environment,
      signal: job.controller.signal,
    });
    const parsed = parseCells(output, review.columns);
    if (!parsed.size) throw new Error(`Réponse IA inexploitable : ${output.trim().slice(0, 400) || 'réponse vide'}`);
    await updateReview(job.project, job.file, (current) => {
      const target = current.rows.find((entry) => entry.id === rowId);
      if (!target) return;
      current.cells[rowId] = completeCells(current, parsed);
      Object.assign(target, { status: 'done', finishedAt: new Date().toISOString(), error: undefined });
    });
  } catch (error) {
    const cancelled = job.controller.signal.aborted;
    await updateReview(job.project, job.file, (current) => {
      const target = current.rows.find((entry) => entry.id === rowId);
      if (!target) return;
      Object.assign(target, {
        status: cancelled ? 'cancelled' : 'error',
        finishedAt: new Date().toISOString(),
        error: cancelled ? undefined : (error instanceof Error ? error.message : String(error)),
      });
    });
  }
}

async function worker(job: Job): Promise<void> {
  while (!job.controller.signal.aborted && job.queue.length) {
    const rowId = job.queue.shift()!;
    try {
      await runRow(job, rowId);
    } catch (error) {
      process.stderr.write(`Tabular Review : ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
}

function spawnWorkers(job: Job, count: number): void {
  for (let index = 0; index < count; index += 1) {
    job.workers += 1;
    void worker(job).finally(() => {
      job.workers -= 1;
      if (job.workers === 0 && jobs.get(reviewKey(job.project, job.file)) === job) jobs.delete(reviewKey(job.project, job.file));
    });
  }
}

export async function queueRows(project: string, file: string, rowIds: string[], concurrency: number, environment: NodeJS.ProcessEnv): Promise<void> {
  const key = reviewKey(project, file);
  const existing = jobs.get(key);
  if (existing && !existing.controller.signal.aborted) {
    const queued = new Set(existing.queue);
    existing.queue.push(...rowIds.filter((rowId) => !queued.has(rowId)));
    spawnWorkers(existing, Math.max(0, Math.min(concurrency, existing.queue.length) - existing.workers));
    return;
  }
  await updateReview(project, file, (review) => {
    for (const row of review.rows) {
      if (rowIds.includes(row.id)) Object.assign(row, { status: 'pending', error: undefined, startedAt: undefined, finishedAt: undefined });
    }
  });
  const job: Job = { project, file, queue: [...rowIds], workers: 0, controller: new AbortController(), environment };
  jobs.set(key, job);
  spawnWorkers(job, Math.max(1, Math.min(concurrency, rowIds.length)));
}

export async function cancelJob(project: string, file: string): Promise<void> {
  const job = jobs.get(reviewKey(project, file));
  if (job) {
    job.queue.length = 0;
    job.controller.abort();
  }
  await updateReview(project, file, (review) => {
    for (const row of review.rows) {
      if (row.status === 'pending' || (!job && row.status === 'running')) Object.assign(row, { status: 'cancelled', finishedAt: new Date().toISOString() });
    }
  });
}

export function stopAllJobs(): void {
  for (const job of jobs.values()) {
    job.queue.length = 0;
    job.controller.abort();
  }
}
