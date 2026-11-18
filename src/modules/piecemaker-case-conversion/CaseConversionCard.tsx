import { FileCog, Loader2, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { requestWorkspacePanel } from '@/modules/piecemaker-workspace-tabs';
import { pmGet } from '@/piecemaker/dossier/api';
import {
  getTrackedAnonymizationJobs,
  startAnonymization,
  subscribeTrackedAnonymizationJobs,
  trackAnonymizationJob,
} from '@/piecemaker/dossier/anonymizationJobsCache';
import type { Project } from '@/shared/types';
import { Button } from '@/shared/ui';

const DOSSIER_TAB = 'plugin:piecemaker-dossier';
const MAPPING_EVENT = 'piecemaker:mapping-show';
const MAPPING_KEY = '__piecemakerMappingShow';
const ANONYMIZATION_STATE_EVENT = 'piecemaker:anonymization-state';
const STATUSES_TO_CONVERT = new Set(['not-converted', 'awaiting-scan']);
const EXTERNAL_JOB_POLL_MS = 4_000;

type CaseRef = Pick<Project, 'projectId' | 'fullPath' | 'displayName'>;

type CaseStatus = { pieces: number; toConvert: number; mappingValidated: boolean; excluded: boolean };

type ScanJob = { id: string; projectId: string; state: 'running' | 'done' | 'error' | 'cancelled' | 'ocr-required'; percent: number; error: string | null };

async function readCaseStatus(project: CaseRef): Promise<CaseStatus> {
  const [{ pieces }, etapes] = await Promise.all([
    pmGet<{ pieces: { status: string }[] }>('/knowledge/pieces', { projectId: project.projectId }),
    pmGet<{ mappingValide?: string; nonJuridique?: boolean }>('/etapes/dossier', { projectPath: project.fullPath }),
  ]);
  return {
    pieces: pieces.length,
    toConvert: pieces.filter((piece) => STATUSES_TO_CONVERT.has(piece.status)).length,
    mappingValidated: Boolean(etapes.mappingValide),
    excluded: Boolean(etapes.nonJuridique),
  };
}

function readScanJob(project: CaseRef, id = '') {
  return pmGet<{ job: ScanJob | null }>('/knowledge/scan/job', { id, projectId: project.projectId }).then(({ job }) => job);
}

function track(project: CaseRef, job: ScanJob) {
  trackAnonymizationJob({
    projectPath: project.fullPath,
    projectName: project.displayName,
    job: { id: job.id, case: job.projectId, state: job.state, percent: job.percent, error: job.error },
  });
}

function openMappingReview(projectPath: string) {
  (window as Window & { [MAPPING_KEY]?: string | null })[MAPPING_KEY] = projectPath;
  requestWorkspacePanel(DOSSIER_TAB);
  window.dispatchEvent(new Event(MAPPING_EVENT));
}

export function CaseConversionCard({ project: selectedProject }: { project: Project | null }) {
  const projectId = selectedProject?.projectId;
  const fullPath = selectedProject?.fullPath;
  const displayName = selectedProject?.displayName;
  const project = useMemo<CaseRef | null>(
    () => (projectId && fullPath ? { projectId, fullPath, displayName: displayName || fullPath } : null),
    [projectId, fullPath, displayName],
  );
  const [status, setStatus] = useState<CaseStatus | null>(null);
  const [launching, setLaunching] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobs = useSyncExternalStore(subscribeTrackedAnonymizationJobs, getTrackedAnonymizationJobs);
  const running = project ? jobs.find((entry) => entry.projectPath === project.fullPath) ?? null : null;
  const lastJobId = useRef<string | null>(null);
  const currentPath = useRef(fullPath);
  currentPath.current = fullPath;

  const refresh = useCallback(async () => {
    if (!project) return;
    try {
      const next = await readCaseStatus(project);
      if (currentPath.current === project.fullPath) setStatus(next);
    } catch {
      if (currentPath.current === project.fullPath) setStatus(null);
    }
  }, [project]);

  useEffect(() => {
    setStatus(null);
    setFinished(false);
    setError(null);
    lastJobId.current = null;
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (running) {
      lastJobId.current = running.job.id;
      return;
    }
    const jobId = lastJobId.current;
    if (!jobId || !project) return;
    lastJobId.current = null;
    void readScanJob(project, jobId).catch(() => null).then((job) => {
      if (job?.state === 'done') setFinished(true);
      if (job?.state === 'error') setError(job.error || 'La conversion a échoué.');
      return refresh();
    });
  }, [running, project, refresh]);

  const waitingForConversion = Boolean(project && status && !status.excluded && status.toConvert > 0 && !running);
  useEffect(() => {
    if (!waitingForConversion || !project) return;
    let active = true;
    const adopt = () => void readScanJob(project).then((job) => {
      if (active && job?.state === 'running') track(project, job);
    }).catch(() => undefined);
    adopt();
    const timer = window.setInterval(adopt, EXTERNAL_JOB_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [waitingForConversion, project]);

  useEffect(() => {
    if (!project) return;
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<{ project?: string | null }>).detail;
      if (detail?.project === project.fullPath) void refresh();
    };
    window.addEventListener(ANONYMIZATION_STATE_EVENT, sync);
    return () => window.removeEventListener(ANONYMIZATION_STATE_EVENT, sync);
  }, [project, refresh]);

  if (!project) return null;

  if (running) {
    const percent = Math.max(0, Math.min(100, running.job.percent ?? 0));
    return (
      <section className="mx-auto mb-2 w-full max-w-[54.25rem] px-4" data-piecemaker-case-conversion="running">
        <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
            <span className="font-medium">Conversion du dossier en cours</span>
            <span className="ml-auto tabular-nums text-muted-foreground">{Math.round(percent)} %</span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={`Conversion de ${project.displayName}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
          >
            <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${percent}%` }} />
          </div>
        </div>
      </section>
    );
  }

  if (!status || status.excluded) return null;

  if (status.toConvert > 0) {
    const launch = async () => {
      setLaunching(true);
      setError(null);
      setFinished(false);
      try {
        await startAnonymization({ projectId: project.projectId, projectPath: project.fullPath, projectName: project.displayName }, 'ask');
      } catch (cause) {
        const job = await readScanJob(project).catch(() => null);
        if (job?.state === 'running') track(project, job);
        else setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLaunching(false);
      }
    };
    return (
      <section className="mx-auto mb-2 w-full max-w-[54.25rem] px-4" data-piecemaker-case-conversion="convert">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2">
          <FileCog className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-sm">
            <span className="font-medium">Dossier non converti.</span>{' '}
            <span className="text-muted-foreground">
              {status.toConvert} pièce{status.toConvert > 1 ? 's' : ''} à convertir et anonymiser avant que l’assistant puisse les lire.
            </span>
          </span>
          <Button size="sm" disabled={launching} onClick={() => void launch()}>
            {launching && <Loader2 className="h-4 w-4 animate-spin" />}
            Convertir le dossier
          </Button>
          {error && <p className="w-full text-xs text-destructive" role="alert">{error}</p>}
        </div>
      </section>
    );
  }

  if (status.pieces === 0 || status.mappingValidated) return null;

  return (
    <section className="mx-auto mb-2 w-full max-w-[54.25rem] px-4" data-piecemaker-case-conversion="review">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2">
        <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="min-w-0 flex-1 text-sm">
          <span className="font-medium">{finished ? 'Conversion terminée.' : 'Mapping à valider.'}</span>{' '}
          <span className="text-muted-foreground">Relisez et validez le mapping d’anonymisation du dossier.</span>
        </span>
        <Button size="sm" onClick={() => openMappingReview(project.fullPath)}>
          Relire le mapping
        </Button>
      </div>
    </section>
  );
}
