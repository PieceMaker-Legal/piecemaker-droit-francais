import { pmGet, pmPost } from '@/piecemaker/dossier/api';

const STORAGE_KEY = 'piecemaker.sidebarAnonymizationJobs';
const POLL_INTERVAL_MS = 1_000;

type AnonymizationJobState = 'running' | 'done' | 'error' | 'cancelled' | 'ocr-required';

type AnonymizationJob = {
  id: string;
  case: string;
  state: AnonymizationJobState;
  percent?: number;
  error?: string | null;
  ocrRequired?: { files: string[] } | null;
};

export type TrackedAnonymizationJob = {
  projectPath: string;
  projectName: string;
  job: AnonymizationJob;
};

export type AnonymizationTarget = {
  projectId: string;
  projectPath: string;
  projectName: string;
};

export type OcrDecisionRequest = AnonymizationTarget & { files: string[] };

export type OcrMissingChoice = 'ask' | 'continue';

type KnowledgeScanJob = {
  id: string;
  projectId: string;
  state: AnonymizationJobState;
  percent: number;
  error: string | null;
  ocrRequired?: { files: string[] } | null;
};

export const ANONYMIZATION_COMPLETED_EVENT = 'piecemaker:anonymization-completed';

export const OCR_DECISION_EVENT = 'piecemaker:ocr-decision';

function jobIsPending(job: AnonymizationJob): boolean {
  return job.state === 'running';
}

function announceCompletion(job: AnonymizationJob | null | undefined): void {
  if (job?.state === 'done') window.dispatchEvent(new CustomEvent(ANONYMIZATION_COMPLETED_EVENT));
}

function announceOcrDecision(entry: Omit<TrackedAnonymizationJob, 'job'>, job: AnonymizationJob | null | undefined): void {
  if (job?.state !== 'ocr-required') return;
  const request: OcrDecisionRequest = {
    projectId: job.case,
    projectPath: entry.projectPath,
    projectName: entry.projectName,
    files: job.ocrRequired?.files ?? [],
  };
  window.dispatchEvent(new CustomEvent<OcrDecisionRequest>(OCR_DECISION_EVENT, { detail: request }));
}

function knowledgeJobAsTracked(job: KnowledgeScanJob): AnonymizationJob {
  return {
    id: job.id,
    case: job.projectId,
    state: job.state,
    percent: job.percent,
    error: job.error,
    ocrRequired: job.ocrRequired ?? null,
  };
}

function readFromStorage(): TrackedAnonymizationJob[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return (value as TrackedAnonymizationJob[]).filter((entry) => entry?.projectPath && entry?.job && jobIsPending(entry.job));
  } catch {
    return [];
  }
}

function writeToStorage(jobs: TrackedAnonymizationJob[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  } catch {
    // best-effort persistence only
  }
}

let trackedJobs = readFromStorage();
const listeners = new Set<() => void>();
let pollTimer = 0;

function syncPolling(): void {
  if (trackedJobs.length && !pollTimer) {
    pollTimer = window.setInterval(() => void refreshTrackedJobs(), POLL_INTERVAL_MS);
    return;
  }
  if (!trackedJobs.length && pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = 0;
  }
}

function publish(jobs: TrackedAnonymizationJob[]): void {
  trackedJobs = jobs;
  writeToStorage(trackedJobs);
  syncPolling();
  listeners.forEach((listener) => listener());
}

async function pollEntry(entry: TrackedAnonymizationJob): Promise<AnonymizationJob | null> {
  const { job } = await pmGet<{ job: KnowledgeScanJob | null }>('/knowledge/scan/job', { id: entry.job.id, projectId: entry.job.case });
  return job ? knowledgeJobAsTracked(job) : null;
}

async function refreshTrackedJobs(): Promise<void> {
  const polled = new Map<string, AnonymizationJob | null>();
  await Promise.all(trackedJobs.map(async (entry) => {
    try {
      polled.set(entry.job.id, await pollEntry(entry));
    } catch {
      polled.set(entry.job.id, null);
    }
  }));
  publish(trackedJobs.flatMap((entry) => {
    if (!polled.has(entry.job.id)) return [entry];
    const job = polled.get(entry.job.id);
    announceCompletion(job);
    announceOcrDecision(entry, job);
    return job && jobIsPending(job) ? [{ ...entry, job }] : [];
  }));
}

/**
 * Shared registry of the anonymization jobs still queued or running, keyed by
 * case folder path. Written by every launch point — the sidebar dialog
 * (`AnonymizationLauncher`) and the « Relancer » menu of the dossier
 * mapping badge — and read by the sidebar progress bars, so a run started from the dossier
 * panel shows its progress in the project row too. Owns the polling and the
 * localStorage persistence: entries disappear on their own once the server
 * reports the job finished or failed.
 */
export function getTrackedAnonymizationJobs(): TrackedAnonymizationJob[] {
  return trackedJobs;
}

export function subscribeTrackedAnonymizationJobs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function trackAnonymizationJob(entry: TrackedAnonymizationJob): void {
  if (!jobIsPending(entry.job)) return;
  publish([...trackedJobs.filter((tracked) => tracked.projectPath !== entry.projectPath), entry]);
}

export async function startAnonymization(target: AnonymizationTarget, ocrMissing: OcrMissingChoice): Promise<void> {
  const { job } = await pmPost<{ job: KnowledgeScanJob }>('/knowledge/scan', { projectId: target.projectId, ocrMissing });
  trackAnonymizationJob({ projectPath: target.projectPath, projectName: target.projectName, job: knowledgeJobAsTracked(job) });
}

/** Used by the tests to isolate this module state between cases. */
export function clearTrackedAnonymizationJobs(): void {
  publish([]);
}

/**
 * The dossier plugin runs in an isolated module and cannot import this
 * registry, so it announces its scans on the window instead. Receiving them
 * here is what lets a scan launched from the plugin tab draw the same progress
 * bar in the project row, and keep drawing it once that tab is unmounted.
 */
export const KNOWLEDGE_SCAN_EVENT = 'piecemaker:knowledge-scan-job';

type KnowledgeScanBroadcast = { projectPath: string; projectName: string; job: KnowledgeScanJob };

export function receiveKnowledgeScanBroadcast(detail: KnowledgeScanBroadcast | null | undefined): void {
  if (!detail?.projectPath || !detail.job?.id) return;
  const job = knowledgeJobAsTracked(detail.job);
  announceCompletion(job);
  announceOcrDecision({ projectPath: detail.projectPath, projectName: detail.projectName || detail.projectPath }, job);
  if (!jobIsPending(job)) {
    publish(trackedJobs.filter((tracked) => tracked.job.id !== job.id));
    return;
  }
  trackAnonymizationJob({ projectPath: detail.projectPath, projectName: detail.projectName || detail.projectPath, job });
}

window.addEventListener(KNOWLEDGE_SCAN_EVENT, (event) => {
  receiveKnowledgeScanBroadcast((event as CustomEvent<KnowledgeScanBroadcast>).detail);
});
