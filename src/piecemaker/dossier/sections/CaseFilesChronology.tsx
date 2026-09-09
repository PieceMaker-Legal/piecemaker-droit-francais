/**
 * "Chronologie" view of a case file: the timeline of pieces built from the
 * legal graph, its build status, PDF/DOCX export and manual metadata
 * correction. Mirrors PieceMaker-Installer's admin/app.js chronology pane
 * (loadChronology, renderTimeline, exportChronology) against the routes
 * mounted under /api/piecemaker. The interactive "graphe des liens" view has
 * no equivalent here — see the final report for why.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CalendarClock, Download, Loader2, Pencil, RefreshCw, Sparkles } from 'lucide-react';

import { Badge, Button } from '@/shared/ui';
import { authenticatedFetch } from '@/shared/api';
import { cn } from '@/shared/utils';
import { invalidatePmGet, pmGetCached, pmPost, PieceMakerApiError, PIECEMAKER_API_BASE } from '@/piecemaker/dossier/api';
import CaseFilesDocumentMetaDialog from '@/piecemaker/dossier/sections/CaseFilesDocumentMetaDialog';
import type { ChronologyDocument, ChronologyExportFormat, ChronologyOverview } from '@/piecemaker/dossier/sections/CaseFilesTypes';
import { chronologyStateModel, formatDateIso } from '@/piecemaker/dossier/sections/CaseFilesUtils';

type CaseFilesChronologyProps = {
  caseId: string;
  caseName: string;
  refreshVersion: number;
};

export default function CaseFilesChronology({ caseId, caseName, refreshVersion }: CaseFilesChronologyProps) {
  const [chronology, setChronology] = useState<ChronologyOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState<ChronologyExportFormat | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<ChronologyDocument | null>(null);
  const loadSequence = useRef(0);

  const load = useCallback(async (refresh = false) => {
    const requestSequence = ++loadSequence.current;
    setLoading(true);
    try {
      const caseQuery = { case: caseId };
      if (refresh) invalidatePmGet('/repository/chronology', caseQuery);
      const data = await pmGetCached<ChronologyOverview>('/repository/chronology', caseQuery);
      if (requestSequence !== loadSequence.current) return;
      setChronology(data);
      setError(null);
    } catch (cause) {
      if (requestSequence !== loadSequence.current) return;
      setChronology(null);
      setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      if (requestSequence === loadSequence.current) setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load, refreshVersion]);

  const refreshGraph = async () => {
    setRefreshing(true);
    setMessage(null);
    try {
      await pmPost('/repository/legal-graph/refresh', { case: caseId });
      await load(true);
    } catch (cause) {
      setMessage(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setRefreshing(false);
    }
  };

  const exportChronology = async (format: ChronologyExportFormat) => {
    setExporting(format);
    setMessage(null);
    try {
      const response = await authenticatedFetch(
        `${PIECEMAKER_API_BASE}/repository/chronology/export?case=${encodeURIComponent(caseId)}&format=${format}`,
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new PieceMakerApiError(payload?.error || `Erreur ${response.status}`, response.status);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = `Chronologie - ${caseName}.${format}`;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setMessage(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setExporting(null);
    }
  };

  if (loading && !chronology) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Chargement de la chronologie…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md py-16 text-center text-sm">
        <p className="text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
          Réessayer
        </Button>
      </div>
    );
  }

  if (!chronology) return null;

  const state = chronologyStateModel(chronology.graph);
  const rows = [...chronology.datedDocuments, ...chronology.undatedDocuments];

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/50 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{chronology.stats.documents} pièce(s)</span>
          <span>·</span>
          <span>{chronology.stats.dated} datée(s)</span>
          <span>·</span>
          <span>{chronology.stats.entities} entité(s)</span>
          {chronology.stats.span && (
            <>
              <span>·</span>
              <span>
                {formatDateIso(chronology.stats.span.from)} → {formatDateIso(chronology.stats.span.to)}
              </span>
            </>
          )}
          <Badge variant="outline" className={cn('ml-1', state.tone)}>
            {state.label}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="secondary" size="sm" disabled={!state.canRefresh || refreshing} onClick={() => void refreshGraph()}>
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Actualiser l’analyse juridique
          </Button>
          <Button variant="ghost" size="sm" disabled={exporting !== null} onClick={() => void exportChronology('pdf')}>
            {exporting === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            PDF
          </Button>
          <Button variant="ghost" size="sm" disabled={exporting !== null} onClick={() => void exportChronology('docx')}>
            {exporting === 'docx' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            DOCX
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void load(true)}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {state.detail && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {state.detail}
        </p>
      )}
      {message && <p className="text-xs text-destructive">{message}</p>}

      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50">
            <CalendarClock className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">Aucune pièce indexée pour cette chronologie.</p>
        </div>
      ) : (
        <div className="flex-1 space-y-1.5 overflow-y-auto">
          {rows.map((document) => (
            <div key={document.documentKey} className="flex gap-3 rounded-lg border border-border/50 px-3 py-2 hover:bg-accent/30">
              <div className="w-24 shrink-0 pt-0.5 text-xs text-muted-foreground">{formatDateIso(document.dateIso)}</div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{document.name}</span>
                  {document.nature && <Badge variant="secondary">{document.nature}</Badge>}
                  {document.reviewRequired && (
                    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      À vérifier
                    </Badge>
                  )}
                </div>
                {document.juridiction && <p className="mt-0.5 text-xs text-muted-foreground">{document.juridiction}</p>}
                {document.fields.length > 0 && (
                  <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    {document.fields.map((field, index) => (
                      <div key={index} className="flex gap-1">
                        <dt className="font-medium">{field.label}</dt>
                        <dd>{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {document.reviewReasons.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">{document.reviewReasons.join(' · ')}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                disabled={!document.path}
                onClick={() => setEditing(document)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <CaseFilesDocumentMetaDialog
          caseId={caseId}
          document={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load(true);
          }}
        />
      )}
    </div>
  );
}
