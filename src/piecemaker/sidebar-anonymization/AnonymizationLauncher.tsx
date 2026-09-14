import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Loader2, ScanSearch, ShieldCheck } from 'lucide-react';

import { api } from '@/shared/api';
import type { Project } from '@/shared/types';
import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { pmGet, pmPost, PieceMakerApiError } from '@/piecemaker/dossier/api';
import { setMappingReady } from '@/piecemaker/dossier/mappingStatusCache';
import type { OriginalsJob } from '@/piecemaker/dossier/sections/CaseFilesTypes';

type ProjectJob = {
  projectId: string;
  projectName: string;
  projectPath: string;
  caseReference: string;
  job: OriginalsJob;
};

type AnonymizationLauncherProps = {
  buttonSlots: HTMLElement[];
  progressSlots: Map<string, HTMLElement>;
  onProjectsChange: (projects: Project[]) => void;
};

const STORAGE_KEY = 'piecemaker.sidebarAnonymizationJobs';
const POLL_INTERVAL_MS = 1_000;

function readStoredJobs(): ProjectJob[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function jobIsPending(job: OriginalsJob): boolean {
  return job.state === 'queued' || job.state === 'running';
}

function jobLabel(job: OriginalsJob): string {
  if (job.state === 'queued') {
    return job.queuePosition ? `En attente · position ${job.queuePosition}` : 'En attente';
  }
  if (job.state === 'running') {
    const phase = job.phase === 'scan' ? 'Analyse GLiNER' : job.phase === 'commit' ? 'Enregistrement' : 'Conversion MarkItDown';
    return `${phase} · ${Math.round(job.percent ?? 0)} %`;
  }
  if (job.state === 'done') return 'Anonymisation terminée';
  return job.error || 'Échec de l’anonymisation';
}

function ProjectProgress({ projectJob }: { projectJob: ProjectJob }) {
  const percent = projectJob.job.state === 'done' ? 100 : Math.max(0, Math.min(100, projectJob.job.percent ?? 0));
  return (
    <div className="mt-1 min-w-0" data-piecemaker-anonymization-progress>
      <div className="mb-0.5 flex min-w-0 items-center gap-1 text-[10px] leading-3 text-muted-foreground">
        {jobIsPending(projectJob.job) && <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin text-primary" />}
        {projectJob.job.state === 'done' && <CheckCircle2 className="h-2.5 w-2.5 shrink-0 text-emerald-500" />}
        {projectJob.job.state === 'error' && <AlertCircle className="h-2.5 w-2.5 shrink-0 text-destructive" />}
        <span className="truncate" title={jobLabel(projectJob.job)}>{jobLabel(projectJob.job)}</span>
      </div>
      <div
        className="h-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`Anonymisation de ${projectJob.projectName}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            projectJob.job.state === 'error' ? 'bg-destructive' : projectJob.job.state === 'done' ? 'bg-emerald-500' : 'bg-primary',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function AnonymizationLauncher({ buttonSlots, progressSlots, onProjectsChange }: AnonymizationLauncherProps) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [scannedProjectIds, setScannedProjectIds] = useState<Set<string>>(new Set());
  const [caseReferences, setCaseReferences] = useState<Map<string, string>>(new Map());
  const [loadingProjectStatus, setLoadingProjectStatus] = useState(false);
  const [force, setForce] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [projectJobs, setProjectJobs] = useState<ProjectJob[]>(readStoredJobs);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const projectsLoadedRef = useRef(false);

  const refreshProjects = useCallback(async () => {
    const response = await api.projects();
    if (!response.ok) throw new Error('Impossible de charger les dossiers.');
    const refreshedProjects = await response.json() as Project[];
    projectsLoadedRef.current = true;
    setProjects(refreshedProjects);
    setSelectedProjectIds((current) => {
      const availableIds = new Set(refreshedProjects.map((project) => project.projectId));
      const retainedIds = new Set([...current].filter((projectId) => availableIds.has(projectId)));
      return retainedIds.size ? retainedIds : availableIds;
    });
    onProjectsChange(refreshedProjects);
    setLoadingProjectStatus(true);
    const refreshedScannedIds = new Set<string>();
    const refreshedReferences = new Map<string, string>();
    for (const project of refreshedProjects) {
      try {
        const registration = await pmPost<{ folder: { path: string } }>('/repository/cases/selected', { folder: project.fullPath });
        refreshedReferences.set(project.projectId, registration.folder.path);
        const mapping = await pmGet<{ exists: boolean; mapping: Record<string, string> }>('/mapping', { case: registration.folder.path });
        const scanned = mapping.exists && Object.keys(mapping.mapping).length > 0;
        if (scanned) refreshedScannedIds.add(project.projectId);
        setMappingReady(project.fullPath, scanned);
      } catch {
        setMappingReady(project.fullPath, false);
      }
    }
    setScannedProjectIds(refreshedScannedIds);
    setCaseReferences(refreshedReferences);
    setLoadingProjectStatus(false);
  }, [onProjectsChange]);

  const loadProjects = useCallback(() => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const request = refreshProjects().finally(() => {
      if (refreshPromiseRef.current === request) refreshPromiseRef.current = null;
    });
    refreshPromiseRef.current = request;
    return request;
  }, [refreshProjects]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProjects().catch(() => undefined), 0);
    return () => window.clearTimeout(timer);
  }, [loadProjects]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projectJobs));
  }, [projectJobs]);

  useEffect(() => {
    if (!projectJobs.some((entry) => jobIsPending(entry.job))) return;
    const poll = window.setInterval(() => {
      void Promise.all(projectJobs.filter((entry) => jobIsPending(entry.job)).map(async (entry) => {
        try {
          const { job } = await pmGet<{ job: OriginalsJob }>('/originals/job', { id: entry.job.id });
          return { ...entry, job };
        } catch {
          return { ...entry, job: { ...entry.job, state: 'error' as const, error: 'Suivi du traitement indisponible.' } };
        }
      })).then((updates) => {
        setProjectJobs((current) => current.map((entry) => updates.find((update) => update.job.id === entry.job.id) ?? entry));
      });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(poll);
  }, [projectJobs]);

  const selectedProjects = useMemo(
    () => projects.filter((project) => selectedProjectIds.has(project.projectId)),
    [projects, selectedProjectIds],
  );

  const toggleProject = (projectId: string) => {
    setSelectedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const launch = async () => {
    if (!selectedProjects.length) return;
    setLaunching(true);
    setMessage(null);
    let launchedCount = 0;
    const failures: string[] = [];
    for (const project of selectedProjects) {
      try {
        const caseReference = caseReferences.get(project.projectId)
          ?? (await pmPost<{ folder: { path: string } }>('/repository/cases/selected', { folder: project.fullPath })).folder.path;
        const { job } = await pmPost<{ job: OriginalsJob }>('/originals/pipeline', {
          case: caseReference,
          action: 'anonymize',
          files: [],
          force,
          engine: 'markitdown',
        });
        launchedCount += 1;
        setProjectJobs((current) => [
          ...current.filter((entry) => entry.projectId !== project.projectId),
          {
            projectId: project.projectId,
            projectName: project.displayName,
            projectPath: project.fullPath,
            caseReference,
            job,
          },
        ]);
      } catch (cause) {
        failures.push(`${project.displayName} : ${cause instanceof PieceMakerApiError ? cause.message : String(cause)}`);
      }
    }
    setLaunching(false);
    if (failures.length) {
      setMessage(`${launchedCount} dossier(s) mis en file. ${failures.join(' · ')}`);
      return;
    }
    setMessage(`${launchedCount} dossier(s) mis en file d’attente.`);
  };

  const pendingCount = projectJobs.filter((entry) => jobIsPending(entry.job)).length;

  return (
    <>
      {buttonSlots.map((slot) => createPortal(
        <Button
          key={slot.dataset.piecemakerAnonymizationSlot}
          variant="ghost"
          size="sm"
          className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
          onClick={() => {
            setOpen(true);
            setMessage(null);
            if (!projectsLoadedRef.current) void loadProjects().catch(() => setMessage('Impossible de charger les dossiers.'));
          }}
          title="Anonymiser les dossiers"
          aria-label="Anonymiser les dossiers"
        >
          <span className="relative">
            <ScanSearch className="h-3 w-3" />
            {pendingCount > 0 && (
              <span className="absolute -right-2 -top-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[8px] font-semibold text-primary-foreground">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </span>
        </Button>,
        slot,
      ))}

      {projectJobs.map((entry) => {
        const slot = progressSlots.get(entry.projectPath);
        return slot ? createPortal(<ProjectProgress key={entry.projectId} projectJob={entry} />, slot) : null;
      })}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md p-0">
          <DialogTitle>Anonymisation</DialogTitle>
          <div className="border-b border-border/60 px-5 py-4">
            <div className="flex items-center gap-2">
              <ScanSearch className="h-5 w-5 text-primary" />
              <h2 className="text-base font-semibold">Anonymisation</h2>
            </div>
          </div>
          <div className="space-y-4 px-5 py-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Dossiers à traiter</span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={loadingProjectStatus}
                    onClick={() => setSelectedProjectIds(new Set(projects.filter((project) => !scannedProjectIds.has(project.projectId)).map((project) => project.projectId)))}
                  >
                    Non analysés
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSelectedProjectIds(new Set(projects.map((project) => project.projectId)))}>
                    Tous
                  </Button>
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border/60">
                {projects.map((project) => (
                  <label key={project.projectId} className="flex cursor-pointer items-center gap-3 border-b border-border/40 px-3 py-2.5 last:border-b-0 hover:bg-accent/40">
                    <input
                      type="checkbox"
                      checked={selectedProjectIds.has(project.projectId)}
                      onChange={() => toggleProject(project.projectId)}
                      aria-label={`Sélectionner ${project.displayName}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">{project.displayName}</span>
                      <span className="block truncate text-xs text-muted-foreground" title={project.fullPath}>{project.fullPath}</span>
                    </span>
                    {loadingProjectStatus ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                    ) : scannedProjectIds.has(project.projectId) ? (
                      <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-label="Anonymisation effectuée">
                        <title>Anonymisation effectuée</title>
                      </ShieldCheck>
                    ) : null}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{selectedProjects.length} dossier(s) sélectionné(s)</p>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={force} onChange={(event) => setForce(event.target.checked)} />
              <span>
                <span className="block font-medium">Relancer le traitement complet</span>
                <span className="block text-xs text-muted-foreground">Reconvertit et réanalyse aussi les pièces déjà anonymisées.</span>
              </span>
            </label>
            {message && <p className={cn('text-xs', message.includes('mis en file') && !message.includes(' : ') ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')} role="status">{message}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-border/60 px-5 py-3">
            <Button variant="ghost" onClick={() => setOpen(false)}>Fermer</Button>
            <Button disabled={launching || loadingProjectStatus || selectedProjects.length === 0} onClick={() => void launch()}>
              {launching && <Loader2 className="h-4 w-4 animate-spin" />}
              {force ? 'Relancer' : 'Mettre en file'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
