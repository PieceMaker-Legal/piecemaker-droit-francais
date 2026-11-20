import { FileCog, Loader2, ShieldAlert, X } from 'lucide-react';
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
const EXTERNAL_JOB_POLL_MS = 4_000;

type CaseRef = Pick<Project, 'projectId' | 'fullPath' | 'displayName'>;

type CaseStatus = { aConvertir: boolean; bilan: string; revoirMapping: boolean };

type ScanJob = { id: string; projectId: string; state: 'running' | 'done' | 'error' | 'cancelled' | 'ocr-required'; percent: number; error: string | null };

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
  return project ? <ProjectConversionCard key={project.projectId} project={project} /> : null;
}

function ProjectConversionCard({ project }: { project: CaseRef }) {
  const [dismissed, setDismissed] = useState(false);
  const [status, setStatus] = useState<CaseStatus | null>(null);
  const [launching, setLaunching] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobs = useSyncExternalStore(subscribeTrackedAnonymizationJobs, getTrackedAnonymizationJobs);
  const running = jobs.find((entry) => entry.projectPath === project.fullPath) ?? null;
  const lastJobId = useRef<string | null>(null);
  const revision = useRef(0);
  const refresh = useCallback(async (cached = false) => {
    const current = ++revision.current;
    const params = { projectPath: project.fullPath };
    try {
      if (cached) {
        const saved = await pmGet<CaseStatus | null>('/etapes/conversion', params);
        if (current !== revision.current) return;
        setStatus(saved);
      }
      const next = await pmGet<CaseStatus | null>('/etapes/conversion', { ...params, frais: '1' });
      if (current === revision.current) setStatus(next);
    } catch {
      return;
    }
  }, [project.fullPath]);

  useEffect(() => {
    void refresh(true);
    return () => { revision.current++; };
  }, [refresh]);

  useEffect(() => {
    if (running) {
      lastJobId.current = running.job.id;
      return;
    }
    const jobId = lastJobId.current;
    if (!jobId) return;
    lastJobId.current = null;
    void readScanJob(project, jobId).catch(() => null).then((job) => {
      if (job?.state === 'done') setFinished(true);
      if (job?.state === 'error') setError(job.error || 'La conversion a échoué.');
      return refresh();
    });
  }, [running, project, refresh]);

  const waitingForConversion = Boolean(status?.aConvertir && !running);
  useEffect(() => {
    if (!waitingForConversion) return;
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
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<{ project?: string | null }>).detail;
      if (detail?.project === project.fullPath) void refresh();
    };
    window.addEventListener(ANONYMIZATION_STATE_EVENT, sync);
    return () => window.removeEventListener(ANONYMIZATION_STATE_EVENT, sync);
  }, [project, refresh]);

  if (dismissed) return null;
  const close = (
    <Button size="sm" variant="ghost" aria-label="Fermer la carte de conversion" onClick={() => setDismissed(true)}>
      <X className="h-4 w-4" />
    </Button>
  );

  if (running) {
    const percent = Math.max(0, Math.min(100, running.job.percent ?? 0));
    return (
      <section className="mx-auto mb-2 w-full max-w-[54.25rem] px-4" data-piecemaker-case-conversion="running">
        <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
            <span className="font-medium">Conversion du dossier en cours</span>
            <span className="ml-auto tabular-nums text-muted-foreground">{Math.round(percent)} %</span>
            {close}
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

  if (!status) return null;

  if (status.aConvertir) {
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
            {status.bilan}
          </span>
          <Button size="sm" disabled={launching} onClick={() => void launch()}>
            {launching && <Loader2 className="h-4 w-4 animate-spin" />}
            Convertir le dossier
          </Button>
          {close}
          {error && <p className="w-full text-xs text-destructive" role="alert">{error}</p>}
        </div>
      </section>
    );
  }

  if (!status.revoirMapping) return null;

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
        {close}
      </div>
    </section>
  );
}
