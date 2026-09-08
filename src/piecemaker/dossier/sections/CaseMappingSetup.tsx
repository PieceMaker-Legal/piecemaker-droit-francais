import { useCallback, useEffect, useState } from 'react';
import { Loader2, ScanSearch, ShieldCheck } from 'lucide-react';

import { pmGet, pmPost, PieceMakerApiError } from '@/piecemaker/dossier/api';
import { useDossierCases } from '@/piecemaker/dossier/DossierContext';
import { setMappingReady } from '@/piecemaker/dossier/mappingStatusCache';
import type { CaseOverview, OriginalsJob } from '@/piecemaker/dossier/sections/CaseFilesTypes';
import { describeJob } from '@/piecemaker/dossier/sections/CaseFilesUtils';
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

/**
 * Always-visible mapping-status badge, mounted next to the section tab bar
 * (`DossierPanel`) rather than inline in a section: it needs to stay on screen
 * regardless of which of the three tabs is active. It owns its case-overview
 * fetch (mapping.exists / mapping.entries) rather than receiving it as a prop,
 * since its mount point has no `overview` to read from. `mappingVersion` from
 * the dossier context is the refresh signal: this component bumps it after a
 * successful anonymization run, and re-fetches whenever another part of the
 * app (e.g. `CaseMappingSection`'s manual edits) bumps it too.
 */
export default function CaseMappingSetup() {
  const { selectedCaseId: caseId, mappingVersion, bumpMappingVersion } = useDossierCases();

  const [overview, setOverview] = useState<CaseOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [glinerInstalled, setGlinerInstalled] = useState<boolean | null>(null);
  const [installJob, setInstallJob] = useState<InstallJob | null>(null);
  const [anonymizationJob, setAnonymizationJob] = useState<OriginalsJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    if (!caseId) {
      setOverview(null);
      return;
    }
    setOverviewLoading(true);
    try {
      const { folder } = await pmGet<{ folder: CaseOverview }>('/repository/case', { case: caseId });
      setOverview(folder);
    } catch {
      setOverview(null);
    } finally {
      setOverviewLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview, mappingVersion]);

  useEffect(() => {
    if (!overview) return;
    setMappingReady(overview.location, Boolean(overview.mapping.exists && overview.mapping.entries > 0));
  }, [overview]);

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
    pmGet<GlinerOverview>('/configuration')
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
    if (!anonymizationJob || !['queued', 'running'].includes(anonymizationJob.state)) return;
    const timeout = window.setTimeout(async () => {
      try {
        const { job } = await pmGet<{ job: OriginalsJob }>('/originals/job', { id: anonymizationJob.id });
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

  const anonymize = async () => {
    if (!caseId) return;
    setStarting(true);
    setError(null);
    try {
      const { job } = await pmPost<{ job: OriginalsJob }>('/originals/pipeline', {
        case: caseId,
        action: 'anonymize',
        files: [],
        force: false,
      });
      setAnonymizationJob(job);
    } catch (cause) {
      setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  };

  if (!caseId) return null;

  const mappingReady = Boolean(overview?.mapping.exists && overview.mapping.entries > 0);
  const installing = installJob?.state === 'running';
  const anonymizing = anonymizationJob ? ['queued', 'running'].includes(anonymizationJob.state) : false;
  const busy = starting || installing || anonymizing;
  const progress = installing
    ? installJob.progress || 'Installation de GLiNER en cours…'
    : anonymizing && anonymizationJob
      ? describeJob(anonymizationJob)
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
        <Button size="sm" className="h-6 px-2 text-xs" onClick={() => void anonymize()} disabled={busy}>
          {anonymizing || starting ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanSearch className="h-3 w-3" />}
          {anonymizing ? 'En cours…' : mappingReady ? 'Relancer' : 'Anonymiser'}
        </Button>
      ) : (
        <Button size="sm" className="h-6 px-2 text-xs" onClick={() => void installGliner()} disabled={busy}>
          {installing || starting ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
          {installing ? 'Installation…' : 'Installer'}
        </Button>
      )}
    </div>
  );
}
