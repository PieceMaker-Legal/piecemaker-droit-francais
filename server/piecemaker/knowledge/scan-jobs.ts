import crypto from 'node:crypto';

export type KnowledgeScanPhase = 'convert' | 'scan' | 'commit';

export type KnowledgeScanProgress = {
  phase: KnowledgeScanPhase;
  percent: number;
  processed: number;
  total: number;
};

export type KnowledgeScanJob = {
  id: string;
  projectId: string;
  source: 'knowledge';
  action: 'anonymize';
  state: 'running' | 'done' | 'error' | 'cancelled';
  phase: KnowledgeScanPhase;
  percent: number;
  processed: number;
  total: number;
  error: string | null;
  result: unknown;
  startedAt: string;
  finishedAt: string | null;
};

const COMPLETED_RETENTION_MS = 5 * 60_000;

function isPending(job: KnowledgeScanJob): boolean {
  return job.state === 'running';
}

export function createKnowledgeScanJobs() {
  const jobs = new Map<string, KnowledgeScanJob>();
  const controllers = new Map<string, AbortController>();

  const prune = () => {
    const deadline = Date.now() - COMPLETED_RETENTION_MS;
    for (const [id, job] of jobs) {
      if (isPending(job)) continue;
      if (Date.parse(job.finishedAt || job.startedAt) < deadline) jobs.delete(id);
    }
  };

  const runningForProject = (projectId: string): KnowledgeScanJob | null => {
    for (const job of jobs.values()) if (job.projectId === projectId && isPending(job)) return job;
    return null;
  };

  return {
    start(projectId: string, run: (report: (progress: KnowledgeScanProgress) => void, signal: AbortSignal) => Promise<unknown>): KnowledgeScanJob {
      prune();
      const running = runningForProject(projectId);
      if (running) return running;
      const job: KnowledgeScanJob = {
        id: crypto.randomUUID(),
        projectId,
        source: 'knowledge',
        action: 'anonymize',
        state: 'running',
        phase: 'convert',
        percent: 0,
        processed: 0,
        total: 0,
        error: null,
        result: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      };
      jobs.set(job.id, job);
      const report = (progress: KnowledgeScanProgress) => {
        if (job.state !== 'running') return;
        job.phase = progress.phase;
        job.percent = Math.max(job.percent, Math.min(100, progress.percent));
        job.processed = progress.processed;
        job.total = progress.total || job.total;
      };
      const controller = new AbortController();
      controllers.set(job.id, controller);
      run(report, controller.signal).then((result: unknown) => {
        if (job.state !== 'running') return;
        job.state = 'done';
        job.phase = 'commit';
        job.percent = 100;
        job.result = result ?? null;
      }, (error: unknown) => {
        if (job.state !== 'running') return;
        job.state = 'error';
        job.error = error instanceof Error ? error.message : String(error);
      }).finally(() => {
        controllers.delete(job.id);
        job.finishedAt = job.finishedAt || new Date().toISOString();
      });
      return job;
    },
    get(id: unknown): KnowledgeScanJob | null {
      prune();
      return typeof id === 'string' ? jobs.get(id) || null : null;
    },
    runningForProject(projectId: string): KnowledgeScanJob | null {
      prune();
      return runningForProject(projectId);
    },
    cancel(job: KnowledgeScanJob | null): KnowledgeScanJob | null {
      if (!job || job.state !== 'running') return job;
      job.state = 'cancelled';
      job.finishedAt = new Date().toISOString();
      controllers.get(job.id)?.abort();
      controllers.delete(job.id);
      return job;
    },
  };
}
