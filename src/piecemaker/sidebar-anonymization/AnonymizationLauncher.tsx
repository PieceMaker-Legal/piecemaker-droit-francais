import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, ScanSearch, ShieldCheck } from 'lucide-react';

import { api } from '@/shared/api';
import type { Project } from '@/shared/types';
import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { pmPost, PieceMakerApiError } from '@/piecemaker/dossier/api';
import {
  ANONYMIZATION_COMPLETED_EVENT,
  getTrackedAnonymizationJobs,
  subscribeTrackedAnonymizationJobs,
  trackAnonymizationJob,
} from '@/piecemaker/dossier/anonymizationJobsCache';
import type { TrackedAnonymizationJob } from '@/piecemaker/dossier/anonymizationJobsCache';

type AnonymizationLauncherProps = {
  buttonSlots: HTMLElement[];
  progressSlots: Map<string, HTMLElement>;
  onProjectsChange: (projects: Project[]) => void;
};

function ProjectProgress({ projectJob }: { projectJob: TrackedAnonymizationJob }) {
  const percent = Math.max(0, Math.min(100, projectJob.job.percent ?? 0));
  const label = `${Math.round(percent)} %`;
  return (
    <div className="mt-1 min-w-0" data-piecemaker-anonymization-progress>
      <div className="mb-0.5 flex min-w-0 items-center gap-1 text-[10px] leading-3 text-muted-foreground">
        <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin text-primary" />
        <span className="truncate">{label}</span>
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
          className="h-full rounded-full bg-primary transition-[width] duration-500"
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
  const [launching, setLaunching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const projectJobs = useSyncExternalStore(subscribeTrackedAnonymizationJobs, getTrackedAnonymizationJobs);
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
    setScannedProjectIds(new Set(refreshedProjects.filter((project) => project.anonymizationComplete).map((project) => project.projectId)));
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
    const refreshAfterAnonymization = () => {
      void loadProjects().catch(() => undefined);
    };
    window.addEventListener(ANONYMIZATION_COMPLETED_EVENT, refreshAfterAnonymization);
    return () => window.removeEventListener(ANONYMIZATION_COMPLETED_EVENT, refreshAfterAnonymization);
  }, [loadProjects]);

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
        const { job } = await pmPost<{ job: { id: string; state: 'running' | 'done' | 'error'; percent: number; error: string | null } }>('/knowledge/scan', {
          projectId: project.projectId,
        });
        launchedCount += 1;
        trackAnonymizationJob({
          projectPath: project.fullPath,
          projectName: project.displayName,
          job: {
            id: job.id,
            case: project.projectId,
            state: job.state,
            percent: job.percent,
            error: job.error,
          },
        });
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

  const pendingCount = projectJobs.length;

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
        return slot ? createPortal(<ProjectProgress key={entry.projectPath} projectJob={entry} />, slot) : null;
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
                    {scannedProjectIds.has(project.projectId) ? (
                      <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-label="Anonymisation effectuée">
                        <title>Anonymisation effectuée</title>
                      </ShieldCheck>
                    ) : null}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{selectedProjects.length} dossier(s) sélectionné(s)</p>
            </div>
            {message && <p className={cn('text-xs', message.includes('mis en file') && !message.includes(' : ') ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')} role="status">{message}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-border/60 px-5 py-3">
            <Button variant="ghost" onClick={() => setOpen(false)}>Fermer</Button>
            <Button disabled={launching || selectedProjects.length === 0} onClick={() => void launch()}>
              {launching && <Loader2 className="h-4 w-4 animate-spin" />}
              Mettre en file
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
