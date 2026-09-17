import { pmGet } from '@/piecemaker/dossier/api';

const STORAGE_KEY = 'piecemaker.sidebarAnonymizationJobs';
const POLL_INTERVAL_MS = 1_000;

type AnonymizationJob = {
  id: string;
  case: string;
  state: 'running' | 'done' | 'error' | 'cancelled';
  percent?: number;
  error?: string | null;
};

export type TrackedAnonymizationJob = {
  projectPath: string;
  projectName: string;
  job: AnonymizationJob;
};

type KnowledgeScanJob = {
  id: string;
  projectId: string;
  state: 'running' | 'done' | 'error';
  percent: number;
  error: string | null;
};

export const ANONYMIZATION_COMPLETED_EVENT = 'piecemaker:anonymization-completed';

function jobIsPending(job: AnonymizationJob): boolean {
  return job.state === 'running';
}

function announceCompletion(job: AnonymizationJob | null | undefined): void {
  if (job?.state === 'done') window.dispatchEvent(new CustomEvent(ANONYMIZATION_COMPLETED_EVENT));
}

function knowledgeJobAsTracked(job: KnowledgeScanJob): AnonymizationJob {
  return {
    id: job.id,
    case: job.projectId,
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
  if (!jobIsPending(job)) {
    publish(trackedJobs.filter((tracked) => tracked.job.id !== job.id));
    return;
  }
  trackAnonymizationJob({ projectPath: detail.projectPath, projectName: detail.projectName || detail.projectPath, job });
}

window.addEventListener(KNOWLEDGE_SCAN_EVENT, (event) => {
  receiveKnowledgeScanBroadcast((event as CustomEvent<KnowledgeScanBroadcast>).detail);
});
