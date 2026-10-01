import fs from 'node:fs';
import path from 'node:path';

import type { Cell, Review, ReviewColumn, ReviewRow } from '../shared.js';
import { emptyColumns, MAX_CITATION_CORRECTIONS } from '../shared.js';
import type { CitationDocument } from './citations.js';
import { citationProblems, correctionPrompt, verifyCells } from './citations.js';
import { documentPath, reviewDirectory } from './paths.js';
import { missingCell, parseCells, reviewNote, systemPrompt, userPrompt } from './prompt.js';
import type { PromptDocument } from './prompt.js';
import { readReview, reviewKey, updateReview } from './reviews.js';
import type { Conversation } from './sessions.js';
import { openSession } from './sessions.js';

export const INLINE_CHARACTER_LIMIT = 150_000;

export type RowTask = {
  rowId: string;
  columns?: number[];
};

type Job = {
  project: string;
  file: string;
  queue: RowTask[];
  active: Set<string>;
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

function citationDocuments(project: string, row: ReviewRow): CitationDocument[] {
  return row.documents.map((document) => ({ name: document.source, text: fs.readFileSync(documentPath(project, document.copy), 'utf8') }));
}

function promptDocuments(documents: CitationDocument[], project: string, row: ReviewRow, mode: 'inline' | 'path'): PromptDocument[] {
  return row.documents.map((document, index) => ({
    name: document.source,
    path: documentPath(project, document.copy),
    content: mode === 'inline' ? documents[index].text : null,
  }));
}

async function askWithCorrections(job: Job, rowId: string, session: Conversation, first: string, columns: ReviewColumn[], documents: CitationDocument[]): Promise<{ cells: Map<number, Cell>; corrections: number }> {
  const fallback = documents.length === 1 ? documents[0].name : '';
  const output = await session.send(first);
  const cells = verifyCells(parseCells(output, columns, fallback), documents);
  if (!cells.size) throw new Error(`Réponse IA inexploitable : ${output.trim().slice(0, 400) || 'réponse vide'}`);
  let corrections = 0;
  for (let problems = citationProblems(cells, columns); problems.length && corrections < MAX_CITATION_CORRECTIONS; problems = citationProblems(cells, columns)) {
    corrections += 1;
    await updateReview(job.project, job.file, (current) => {
      const target = current.rows.find((entry) => entry.id === rowId);
      if (target) target.corrections = corrections;
    });
    let answer: string;
    try {
      answer = await session.send(correctionPrompt(problems, corrections, MAX_CITATION_CORRECTIONS));
    } catch (error) {
      if (job.controller.signal.aborted) throw error;
      break;
    }
    const corrected = verifyCells(parseCells(answer, problems.map((problem) => problem.column), fallback), documents);
    for (const [index, cell] of corrected) cells.set(index, cell);
  }
  return { cells, corrections };
}

async function runRow(job: Job, task: RowTask): Promise<void> {
  const { rowId } = task;
  const review = readReview(job.project, job.file);
  const row = review.rows.find((entry) => entry.id === rowId);
  if (!row) return;
  const targets = emptyColumns(review, rowId, task.columns);
  if (!targets.length) {
    await updateReview(job.project, job.file, (current) => {
      const target = current.rows.find((entry) => entry.id === rowId);
      if (target?.status === 'pending') Object.assign(target, { status: 'done', error: undefined });
    });
    return;
  }
  const columns = review.columns.filter((column) => targets.includes(column.index));
  const mode = rowMode(row);
  await updateReview(job.project, job.file, (current) => {
    const target = current.rows.find((entry) => entry.id === rowId);
    if (!target) return;
    Object.assign(target, { status: 'running', mode, startedAt: new Date().toISOString(), finishedAt: undefined, error: undefined, corrections: undefined });
  });
  let session: Conversation | null = null;
  try {
    const documents = citationDocuments(job.project, row);
    session = openSession({
      provider: review.provider,
      model: review.model,
      mode,
      system: systemPrompt(mode),
      readableDirectory: path.join(reviewDirectory(job.project), 'docs'),
      environment: job.environment,
      signal: job.controller.signal,
    });
    const first = userPrompt(row.label, promptDocuments(documents, job.project, row, mode), columns, reviewNote(review));
    const { cells: parsed, corrections } = await askWithCorrections(job, rowId, session, first, columns, documents);
    await updateReview(job.project, job.file, (current) => {
      const target = current.rows.find((entry) => entry.id === rowId);
      if (!target) return;
      const cells = { ...current.cells[rowId] };
      for (const column of columns) cells[String(column.index)] = parsed.get(column.index) ?? missingCell();
      current.cells[rowId] = cells;
      Object.assign(target, { status: 'done', finishedAt: new Date().toISOString(), error: undefined, corrections: corrections || undefined });
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
  } finally {
    session?.close();
  }
}

function takeTask(job: Job): RowTask | null {
  const index = job.queue.findIndex((task) => !job.active.has(task.rowId));
  return index >= 0 ? job.queue.splice(index, 1)[0] : null;
}

async function worker(job: Job): Promise<void> {
  for (let task = takeTask(job); task && !job.controller.signal.aborted; task = takeTask(job)) {
    job.active.add(task.rowId);
    try {
      await runRow(job, task);
    } catch (error) {
      process.stderr.write(`Tabular Review : ${error instanceof Error ? error.message : String(error)}\n`);
    } finally {
      job.active.delete(task.rowId);
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

function mergeTask(queue: RowTask[], task: RowTask): void {
  const existing = queue.find((entry) => entry.rowId === task.rowId);
  if (!existing) {
    queue.push({ ...task });
    return;
  }
  existing.columns = existing.columns && task.columns ? [...new Set([...existing.columns, ...task.columns])] : undefined;
}

export function pendingTasks(review: Review, tasks: RowTask[]): RowTask[] {
  const merged: RowTask[] = [];
  for (const task of tasks) mergeTask(merged, task);
  return merged.filter((task) => review.rows.some((row) => row.id === task.rowId) && emptyColumns(review, task.rowId, task.columns).length);
}

export async function queueTasks(project: string, file: string, tasks: RowTask[], concurrency: number, environment: NodeJS.ProcessEnv): Promise<number> {
  const key = reviewKey(project, file);
  const runnable = pendingTasks(readReview(project, file), tasks);
  const count = runnable.length;
  if (!count) return 0;
  const existing = jobs.get(key);
  const markPending = (review: Review) => {
    for (const row of review.rows) {
      if (runnable.some((task) => task.rowId === row.id) && row.status !== 'running') Object.assign(row, { status: 'pending', error: undefined, startedAt: undefined, finishedAt: undefined });
    }
  };
  if (existing && !existing.controller.signal.aborted) {
    await updateReview(project, file, markPending);
    for (const task of runnable) mergeTask(existing.queue, task);
    spawnWorkers(existing, Math.max(0, Math.min(concurrency, existing.queue.length) - existing.workers));
    return count;
  }
  await updateReview(project, file, markPending);
  const job: Job = { project, file, queue: [...runnable], active: new Set(), workers: 0, controller: new AbortController(), environment };
  jobs.set(key, job);
  spawnWorkers(job, Math.max(1, Math.min(concurrency, count)));
  return count;
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
