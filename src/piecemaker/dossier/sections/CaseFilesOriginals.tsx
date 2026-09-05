/**
 * "Pièces" view of a case file: the original documents, their three-state
 * protection (vault / workspace / resource), and the conversion +
 * anonymization pipeline. Mirrors PieceMaker-Installer's admin/app.js
 * (originals mosaic, protection PUT, pipeline job polling) against the
 * routes mounted under /api/piecemaker.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, Loader2, ShieldCheck, Unlock, BookOpen, X, RefreshCw } from 'lucide-react';

import { Button, Badge, Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';

import { pmGet, pmPost, pmDelete, pmPut, PieceMakerApiError } from '../api';
import type {
  CaseFileEntry,
  CaseMappingSummary,
  OriginalsJob,
  OriginalsPipelineAction,
  PieceProtectionState,
  ProtectionOverview,
} from './CaseFilesTypes';
import {
  describeJob,
  formatBytes,
  formatDateTime,
  originalsStatusLabel,
  pieceProtectionState,
  PIECE_STATE_HINTS,
  PIECE_STATE_LABELS,
} from './CaseFilesUtils';

const JOB_POLL_INTERVAL_MS = 1500;

const PIECE_STATES: { id: PieceProtectionState; icon: typeof ShieldCheck; label: string }[] = [
  { id: 'vault', icon: ShieldCheck, label: 'Protégée' },
  { id: 'workspace', icon: Unlock, label: 'Accessible' },
  { id: 'resource', icon: BookOpen, label: 'Ressource' },
];

type CaseFilesOriginalsProps = {
  caseId: string;
  mapping: CaseMappingSummary;
  onRepositoryChange: () => void;
};

export default function CaseFilesOriginals({ caseId, mapping, onRepositoryChange }: CaseFilesOriginalsProps) {
  const [overview, setOverview] = useState<ProtectionOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<'all' | 'pending'>('all');
  const [force, setForce] = useState(false);
  const [savingPath, setSavingPath] = useState<string | null>(null);
  const [job, setJob] = useState<OriginalsJob | null>(null);
  const [launching, setLaunching] = useState<OriginalsPipelineAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const loadProtection = useCallback(async () => {
    setLoading(true);
    try {
      const data = await pmGet<ProtectionOverview>('/protection', { case: caseId });
      setOverview(data);
      setError(null);
    } catch (cause) {
      setOverview(null);
      setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void loadProtection();
    setSelected(new Set());
    setJob(null);
  }, [loadProtection]);

  // Poll the running pipeline job until it leaves queued/running — mirrors
  // admin/app.js pollOriginalsJob().
  useEffect(() => {
    if (!job || (job.state !== 'queued' && job.state !== 'running')) {
      if (pollRef.current) window.clearInterval(pollRef.current);
      return;
    }
    pollRef.current = window.setInterval(async () => {
      try {
        const { job: fresh } = await pmGet<{ job: OriginalsJob }>('/originals/job', { id: job.id });
        setJob(fresh);
        if (fresh.state === 'done' || fresh.state === 'error') {
          await loadProtection();
          onRepositoryChange();
        }
      } catch {
        // A missing/expired job stops silently; the panel falls back to the static list.
        setJob(null);
      }
    }, JOB_POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [job, loadProtection, onRepositoryChange]);

  const files = overview?.files ?? [];
  const visibleFiles = useMemo(
    () => (scope === 'pending' ? files.filter((file) => file.status !== 'ready') : files),
    [files, scope],
  );

  const toggleSelected = (path: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((current) => {
      if (current.size === visibleFiles.length) return new Set();
      return new Set(visibleFiles.filter((file) => !file.resource).map((file) => file.path));
    });
  };

  const savePieceState = async (file: CaseFileEntry, next: PieceProtectionState) => {
    if (!overview) return;
    const previousFiles = overview.files;
    const nextFiles = previousFiles.map((entry) =>
      entry.path === file.path
        ? { ...entry, protected: next === 'vault', resource: next === 'resource' }
        : entry,
    );
    setOverview({ ...overview, files: nextFiles });
    setSavingPath(file.path);
    try {
      const unprotected = nextFiles.filter((entry) => !entry.protected && !entry.resource).map((entry) => entry.path);
      const resources = nextFiles.filter((entry) => entry.resource).map((entry) => entry.path);
      await pmPut('/protection', { case: caseId, unprotected, resources });
      onRepositoryChange();
    } catch (cause) {
      setOverview({ ...overview, files: previousFiles });
      setMessage(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setSavingPath(null);
    }
  };

  const launchPipeline = async (action: OriginalsPipelineAction) => {
    setLaunching(action);
    setMessage(null);
    try {
      const { job: started } = await pmPost<{ job: OriginalsJob }>('/originals/pipeline', {
        case: caseId,
        action,
        files: [...selected],
        force,
      });
      setJob(started);
      setSelected(new Set());
    } catch (cause) {
      setMessage(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setLaunching(null);
    }
  };

  const cancelJob = async () => {
    if (!job) return;
    try {
      const { job: cancelled } = await pmDelete<{ job: OriginalsJob }>('/originals/job', undefined, { id: job.id });
      setJob(cancelled);
    } catch (cause) {
      setMessage(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    }
  };

  const revealPiece = async (file: CaseFileEntry) => {
    try {
      await pmPost('/reveal', { target: 'files', case: caseId, path: file.path });
    } catch (cause) {
      setMessage(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    }
  };

  const jobRunning = job ? job.state === 'queued' || job.state === 'running' : false;

  if (loading && !overview) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Chargement des pièces…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md py-16 text-center text-sm">
        <p className="text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void loadProtection()}>
          Réessayer
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>{overview?.files.length ?? 0} pièce(s)</span>
          <span>·</span>
          <span>{overview?.protectedCount ?? 0} protégée(s)</span>
          <span>·</span>
          <span>{overview?.resourceCount ?? 0} ressource(s)</span>
          <span>·</span>
          <span>Mapping : {mapping.entries} entrée(s){mapping.exists ? '' : ' (non créé)'}</span>
        </div>
        {overview?.truncated && <Badge variant="outline">Liste tronquée</Badge>}
      </div>

      {jobRunning && job && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-accent/30 px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>{describeJob(job)}</span>
            {typeof job.queuePosition === 'number' && job.queuePosition > 0 && (
              <span className="text-xs text-muted-foreground">(position {job.queuePosition})</span>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={() => void cancelJob()}>
            <X className="h-3.5 w-3.5" /> Annuler
          </Button>
        </div>
      )}
      {job && !jobRunning && (
        <div
          className={cn(
            'flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm',
            job.state === 'error'
              ? 'border-destructive/30 bg-destructive/10 text-destructive'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
          )}
        >
          <span>{job.state === 'error' ? job.error || 'Le traitement a échoué.' : describeJob(job)}</span>
          <Button variant="ghost" size="sm" onClick={() => setJob(null)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
      {message && <p className="text-xs text-destructive">{message}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={selected.size > 0 && selected.size === visibleFiles.filter((f) => !f.resource).length} onChange={toggleSelectAll} />
            Tout sélectionner
          </label>
          <div className="ml-2 inline-flex overflow-hidden rounded-md border border-border/50 text-xs">
            <button
              type="button"
              onClick={() => setScope('all')}
              className={cn('px-2 py-1', scope === 'all' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50')}
            >
              Toutes
            </button>
            <button
              type="button"
              onClick={() => setScope('pending')}
              className={cn('px-2 py-1', scope === 'pending' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50')}
            >
              Non traitées
            </button>
          </div>
          <label className="ml-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
            Retraiter même si déjà fait
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={selected.size === 0 || jobRunning || launching !== null}
            onClick={() => void launchPipeline('convert')}
          >
            {launching === 'convert' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Convertir en Markdown
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={selected.size === 0 || jobRunning || launching !== null}
            onClick={() => void launchPipeline('anonymize')}
          >
            {launching === 'anonymize' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Anonymiser et mapper
          </Button>
        </div>
      </div>

      {visibleFiles.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50">
            <FolderOpen className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            {scope === 'pending' ? 'Toutes les pièces sont converties et scannées.' : 'Aucune pièce originale dans ce dossier.'}
          </p>
        </div>
      ) : (
        <div className="flex-1 space-y-1.5 overflow-y-auto">
          {visibleFiles.map((file) => {
            const state = pieceProtectionState(file);
            return (
              <div
                key={file.path}
                className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2 hover:bg-accent/30"
              >
                {!file.resource && (
                  <input
                    type="checkbox"
                    checked={selected.has(file.path)}
                    onChange={() => toggleSelected(file.path)}
                    disabled={jobRunning}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{file.name}</span>
                    <span className="inline-flex h-5 items-center rounded border border-border/50 px-1 text-[10px] font-bold uppercase text-muted-foreground">
                      {file.extension.replace('.', '') || '—'}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{formatBytes(file.size)}</span>
                    <span>·</span>
                    <span>{formatDateTime(file.modifiedAt)}</span>
                    <span>·</span>
                    <span>{originalsStatusLabel(file)}</span>
                    {file.pipelineEligible === false && (
                      <>
                        <span>·</span>
                        <span>Hors pipeline</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-border/50">
                  {PIECE_STATES.map((entry) => {
                    const Icon = entry.icon;
                    const isActive = entry.id === state;
                    return (
                      <Tooltip key={entry.id} content={PIECE_STATE_HINTS[entry.id]} position="top">
                        <button
                          type="button"
                          disabled={savingPath === file.path}
                          onClick={() => void savePieceState(file, entry.id)}
                          className={cn(
                            'flex h-7 w-7 items-center justify-center transition-colors',
                            isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50',
                          )}
                          aria-pressed={isActive}
                          aria-label={PIECE_STATE_LABELS[entry.id]}
                        >
                          {savingPath === file.path && isActive ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Icon className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </Tooltip>
                    );
                  })}
                </div>

                <Tooltip content="Afficher dans le gestionnaire de fichiers" position="top">
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => void revealPiece(file)}>
                    <FolderOpen className="h-3.5 w-3.5" />
                  </Button>
                </Tooltip>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => void loadProtection()}>
          <RefreshCw className="h-3.5 w-3.5" /> Actualiser
        </Button>
      </div>
    </div>
  );
}
