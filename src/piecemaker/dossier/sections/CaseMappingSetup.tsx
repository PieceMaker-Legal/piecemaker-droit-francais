import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, ScanSearch, ShieldCheck } from 'lucide-react';

import { invalidatePmGet, pmGet, pmGetCached, pmPost, PieceMakerApiError } from '@/piecemaker/dossier/api';
import { trackAnonymizationJob } from '@/piecemaker/dossier/anonymizationJobsCache';
import { useDossierCases } from '@/piecemaker/dossier/DossierContext';
import type { CaseOverview } from '@/piecemaker/dossier/sections/CaseFilesTypes';
import { Button } from '@/shared/ui';

type GlinerOverview = {
  components: {
    gliner: {
      installed: boolean;
    };
  };
};

type InstallJob = {
  id: string;
  state: 'running' | 'done' | 'failed';
  progress: string;
  error: string;
};

type KnowledgeScanJob = {
  id: string;
  projectId: string;
  state: 'running' | 'done' | 'error' | 'cancelled';
  percent: number;
  error: string | null;
};

export default function CaseMappingSetup() {
  const { projectId, selectedCaseId: caseId, mappingVersion, bumpMappingVersion } = useDossierCases();

  const [overview, setOverview] = useState<CaseOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [glinerInstalled, setGlinerInstalled] = useState<boolean | null>(null);
  const [installJob, setInstallJob] = useState<InstallJob | null>(null);
  const [anonymizationJob, setAnonymizationJob] = useState<KnowledgeScanJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overviewRequestSequence = useRef(0);

  const loadOverview = useCallback(async () => {
    const requestSequence = ++overviewRequestSequence.current;
    if (!caseId) {
      setOverview(null);
      setOverviewLoading(false);
      return;
    }
    setOverviewLoading(true);
    try {
      const { folder } = await pmGetCached<{ folder: CaseOverview }>('/repository/case', { case: caseId });
      if (requestSequence !== overviewRequestSequence.current) return;
      setOverview(folder);
    } catch {
      if (requestSequence !== overviewRequestSequence.current) return;
      setOverview(null);
    } finally {
      if (requestSequence === overviewRequestSequence.current) setOverviewLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview, mappingVersion]);

  const loadGlinerStatus = async () => {
    setError(null);
    try {
      const status = await pmGet<GlinerOverview>('/configuration');
      setGlinerInstalled(status.components.gliner.installed);
    } catch (cause) {
      setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    }
  };

  useEffect(() => {
    let active = true;
    pmGetCached<GlinerOverview>('/configuration')
      .then((status) => {
        if (!active) return;
        setGlinerInstalled(status.components.gliner.installed);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!installJob || installJob.state !== 'running') return;
    const timeout = window.setTimeout(async () => {
      try {
        const { job } = await pmGet<{ job: InstallJob }>('/configuration/install', { id: installJob.id });
        setInstallJob(job);
        if (job.state === 'done') {
          invalidatePmGet('/configuration');
          setGlinerInstalled(true);
          setError(null);
        } else if (job.state === 'failed') {
          setError(job.error || 'L’installation de GLiNER a échoué.');
        }
      } catch (cause) {
        setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
      }
    }, 2500);
    return () => window.clearTimeout(timeout);
  }, [installJob]);

  useEffect(() => {
    if (!anonymizationJob || anonymizationJob.state !== 'running') return;
    const timeout = window.setTimeout(async () => {
      try {
        const { job } = await pmGet<{ job: KnowledgeScanJob | null }>('/knowledge/scan/job', { id: anonymizationJob.id, projectId: anonymizationJob.projectId });
        if (!job) return;
        setAnonymizationJob(job);
        if (job.state === 'done') {
          setError(null);
          bumpMappingVersion();
        } else if (job.state === 'error') {
          setError(job.error || 'L’anonymisation a échoué.');
        }
      } catch (cause) {
        setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
      }
    }, 1500);
    return () => window.clearTimeout(timeout);
  }, [anonymizationJob, bumpMappingVersion]);

  const installGliner = async () => {
    setStarting(true);
    setError(null);
    try {
      const { job } = await pmPost<{ job: InstallJob }>('/configuration/install', { component: 'gliner' });
      setInstallJob(job);
    } catch (cause) {
      setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  };

  const mappingReady = Boolean(overview?.mapping.exists && overview.mapping.entries > 0);

  const anonymize = async () => {
    if (!caseId || !projectId) return;
    setStarting(true);
    setError(null);
    try {
      const { job } = await pmPost<{ job: KnowledgeScanJob }>('/knowledge/scan', { projectId });
      setAnonymizationJob(job);
      if (overview) {
        trackAnonymizationJob({
          projectPath: overview.location,
          projectName: overview.name,
          job: { id: job.id, case: projectId, state: job.state, percent: job.percent, error: job.error },
        });
      }
      if (job.state === 'done') bumpMappingVersion();
      if (job.state === 'error') setError(job.error || 'L\u2019anonymisation a \u00e9chou\u00e9.');
    } catch (cause) {
      setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  };

  if (!caseId) return null;

  const installing = installJob?.state === 'running';
  const anonymizing = anonymizationJob?.state === 'running';
  const busy = starting || installing || anonymizing;
  const progress = installing
    ? installJob.progress || 'Installation de GLiNER en cours…'
    : anonymizing && anonymizationJob
      ? `${Math.round(anonymizationJob.percent)} %`
      : null;

  const tone = mappingReady
    ? 'border-emerald-500/30 bg-emerald-500/10'
    : 'border-amber-500/30 bg-amber-500/10';
  const iconColor = mappingReady
    ? 'text-emerald-700 dark:text-emerald-300'
    : 'text-amber-700 dark:text-amber-300';
  const status = progress || (overviewLoading
    ? 'Vérification…'
    : mappingReady
      ? `${overview?.mapping.entries} anonymisé(s)`
      : glinerInstalled === null
        ? 'Vérification…'
        : glinerInstalled
          ? 'Aucun mapping'
          : 'GLiNER requis');

  return (
    <div className={`ml-auto flex h-8 shrink-0 items-center gap-2 rounded-md border px-2.5 text-xs ${tone}`}>
      {mappingReady ? (
        <ShieldCheck className={`h-3.5 w-3.5 shrink-0 ${iconColor}`} />
      ) : (
        <ScanSearch className={`h-3.5 w-3.5 shrink-0 ${iconColor}`} />
      )}
      <span className="whitespace-nowrap font-medium">{status}</span>
      {error && <span className="truncate text-destructive">{error}</span>}
      {glinerInstalled === null && error ? (
        <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => void loadGlinerStatus()}>Réessayer</Button>
      ) : glinerInstalled === null ? (
        <Button variant="outline" size="sm" className="h-6 px-2 text-xs" disabled><Loader2 className="h-3 w-3 animate-spin" /></Button>
      ) : glinerInstalled ? (
        anonymizing || starting ? (
          <Button size="sm" className="h-6 px-2 text-xs" disabled>
            <Loader2 className="h-3 w-3 animate-spin" />
            En cours…
          </Button>
        ) : (
          <Button size="sm" className="h-6 px-2 text-xs" onClick={() => void anonymize()}>
            <ScanSearch className="h-3 w-3" />
            {mappingReady ? 'Rescanner' : 'Anonymiser'}
          </Button>
        )
      ) : (
        <Button size="sm" className="h-6 px-2 text-xs" onClick={() => void installGliner()} disabled={busy}>
          {installing || starting ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
          {installing ? 'Installation…' : 'Installer'}
        </Button>
      )}
    </div>
  );
}
