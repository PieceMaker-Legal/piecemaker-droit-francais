import { useEffect, useState } from 'react';
import { Loader2, ScanSearch, ShieldCheck } from 'lucide-react';

import { pmGet, pmPost, PieceMakerApiError } from '@/piecemaker/dossier/api';
import type { OriginalsJob } from '@/piecemaker/dossier/sections/CaseFilesTypes';
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

type CaseMappingSetupProps = {
  caseId: string;
  onMappingCreated: () => Promise<void>;
};

export default function CaseMappingSetup({ caseId, onMappingCreated }: CaseMappingSetupProps) {
  const [glinerInstalled, setGlinerInstalled] = useState<boolean | null>(null);
  const [installJob, setInstallJob] = useState<InstallJob | null>(null);
  const [anonymizationJob, setAnonymizationJob] = useState<OriginalsJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGlinerStatus = async () => {
    setError(null);
    try {
      const overview = await pmGet<GlinerOverview>('/configuration');
      setGlinerInstalled(overview.components.gliner.installed);
    } catch (cause) {
      setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    }
  };

  useEffect(() => {
    let active = true;
    pmGet<GlinerOverview>('/configuration')
      .then((overview) => {
        if (!active) return;
        setGlinerInstalled(overview.components.gliner.installed);
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
          await onMappingCreated();
        } else if (job.state === 'error') {
          setError(job.error || 'L’anonymisation a échoué.');
        }
      } catch (cause) {
        setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
      }
    }, 1500);
    return () => window.clearTimeout(timeout);
  }, [anonymizationJob, onMappingCreated]);

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

  const installing = installJob?.state === 'running';
  const anonymizing = anonymizationJob ? ['queued', 'running'].includes(anonymizationJob.state) : false;
  const busy = starting || installing || anonymizing;
  const progress = installing
    ? installJob.progress || 'Installation de GLiNER en cours…'
    : anonymizing && anonymizationJob
      ? describeJob(anonymizationJob)
      : null;

  return (
    <div className="mx-4 mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300">
        {glinerInstalled ? <ScanSearch className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Aucun mapping d’anonymisation</p>
        <p className="text-xs text-muted-foreground">
          {progress || (glinerInstalled === null
            ? 'Vérification de GLiNER…'
            : glinerInstalled
              ? 'Analysez les pièces en attente pour créer le mapping du dossier.'
              : 'GLiNER doit être installé avant d’analyser les pièces.')}
        </p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      {glinerInstalled === null && error ? (
        <Button variant="outline" size="sm" onClick={() => void loadGlinerStatus()}>Réessayer</Button>
      ) : glinerInstalled === null ? (
        <Button variant="outline" size="sm" disabled><Loader2 className="h-3.5 w-3.5 animate-spin" />Vérification…</Button>
      ) : glinerInstalled ? (
        <Button size="sm" onClick={() => void anonymize()} disabled={busy}>
          {anonymizing || starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />}
          {anonymizing ? 'Anonymisation…' : 'Anonymiser'}
        </Button>
      ) : (
        <Button size="sm" onClick={() => void installGliner()} disabled={busy}>
          {installing || starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          {installing ? 'Installation…' : 'Installer GLiNER'}
        </Button>
      )}
    </div>
  );
}
