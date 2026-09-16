import { pmGet } from '@/piecemaker/dossier/api';
import { setAnonymizationComplete } from '@/piecemaker/dossier/mappingStatusCache';
import type { OriginalsJob } from '@/piecemaker/dossier/sections/CaseFilesTypes';

const STORAGE_KEY = 'piecemaker.sidebarAnonymizationJobs';
const POLL_INTERVAL_MS = 1_000;

export type AnonymizationJobSource = 'originals' | 'knowledge';

export type TrackedAnonymizationJob = {
  projectPath: string;
  projectName: string;
  job: OriginalsJob;
  source?: AnonymizationJobSource;
};

type KnowledgeScanJob = {
  id: string;
  projectId: string;
  state: 'running' | 'done' | 'error';
  percent: number;
  error: string | null;
};

function jobIsPending(job: OriginalsJob): boolean {
  return job.state === 'queued' || job.state === 'running';
}

function knowledgeJobAsOriginals(job: KnowledgeScanJob): OriginalsJob {
  return {
    id: job.id,
    case: job.projectId,
    action: 'anonymize',
    state: job.state,
    percent: job.percent,
    error: job.error,
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

async function pollEntry(entry: TrackedAnonymizationJob): Promise<OriginalsJob | null> {
  if (entry.source === 'knowledge') {
    const { job } = await pmGet<{ job: KnowledgeScanJob | null }>('/knowledge/scan/job', { id: entry.job.id, projectId: entry.job.case });
    return job ? knowledgeJobAsOriginals(job) : null;
  }
  const { job } = await pmGet<{ job: OriginalsJob }>('/originals/job', { id: entry.job.id });
  return job;
}

async function refreshTrackedJobs(): Promise<void> {
  const polled = new Map<string, OriginalsJob | null>();
  await Promise.all(trackedJobs.map(async (entry) => {
    try {
      const job = await pollEntry(entry);
      polled.set(entry.job.id, job && jobIsPending(job) ? job : null);
    } catch {
      polled.set(entry.job.id, null);
    }
  }));
  // Recomputed from the current list rather than from the snapshot the poll
  // started on, so a job tracked while the requests were in flight survives.
  publish(trackedJobs.flatMap((entry) => {
    if (!polled.has(entry.job.id)) return [entry];
    const job = polled.get(entry.job.id);
    if (job?.state === 'done') setAnonymizationComplete(entry.projectPath, true);
    return job ? [{ ...entry, job }] : [];
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
  const job = knowledgeJobAsOriginals(detail.job);
  if (!jobIsPending(job)) {
    publish(trackedJobs.filter((tracked) => tracked.job.id !== job.id));
    return;
  }
  trackAnonymizationJob({ projectPath: detail.projectPath, projectName: detail.projectName || detail.projectPath, job, source: 'knowledge' });
}

window.addEventListener(KNOWLEDGE_SCAN_EVENT, (event) => {
  receiveKnowledgeScanBroadcast((event as CustomEvent<KnowledgeScanBroadcast>).detail);
});
