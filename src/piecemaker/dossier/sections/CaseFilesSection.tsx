/**
 * "Dossiers" section of the Dossier tab: register/select a legal case, then
 * drill into its original pieces (protection + conversion + anonymization) or
 * its chronology. Rebuilds, in CloudCLI style, the case-file administration of
 * PieceMaker-Installer's admin/ (index.html + app.js) against the routes now
 * mounted on the CloudCLI server under /api/piecemaker.
 */

import { useCallback, useEffect, useState } from 'react';
import { FolderPlus, FolderSearch, Loader2, FileStack, CalendarClock, FolderOpen } from 'lucide-react';

import { Button, Pill, PillBar } from '@/shared/ui';

import { useDossierCases } from '../DossierContext';
import { pmGet, pmPost, PieceMakerApiError } from '../api';
import type { CaseOverview, RegisterCaseResult } from './CaseFilesTypes';
import CaseFilesOriginals from './CaseFilesOriginals';
import CaseFilesChronology from './CaseFilesChronology';

type ViewId = 'pieces' | 'chronologie';

export default function CaseFilesSection() {
  const { cases, selectedCaseId, selectedCase, selectCase, refreshCases, loading, error } = useDossierCases();
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  const [overview, setOverview] = useState<CaseOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [view, setView] = useState<ViewId>('pieces');

  const loadOverview = useCallback(async () => {
    if (!selectedCaseId) {
      setOverview(null);
      return;
    }
    setOverviewLoading(true);
    try {
      const { folder } = await pmGet<{ folder: CaseOverview }>('/repository/case', { case: selectedCaseId });
      setOverview(folder);
      setOverviewError(null);
    } catch (cause) {
      setOverview(null);
      setOverviewError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setOverviewLoading(false);
    }
  }, [selectedCaseId]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const registerCase = async () => {
    setRegistering(true);
    setRegisterError(null);
    try {
      const result = await pmPost<RegisterCaseResult>('/repository/cases');
      if (result.cancelled || !result.folder) return;
      await refreshCases();
      selectCase(result.folder.path);
    } catch (cause) {
      setRegisterError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setRegistering(false);
    }
  };

  const revealCaseFolder = async () => {
    if (!selectedCaseId) return;
    try {
      await pmPost('/reveal', { target: 'files', case: selectedCaseId });
    } catch {
      // Best-effort convenience action: a failure here doesn't block the rest of the section.
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Chargement des dossiers…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md py-16 text-center text-sm">
        <p className="text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void refreshCases()}>
          Réessayer
        </Button>
      </div>
    );
  }

  if (cases.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50">
          <FolderSearch className="h-7 w-7 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">Aucun dossier juridique enregistré</p>
          <p className="mt-1 text-sm text-muted-foreground">Enregistrez un dossier existant sur cet ordinateur pour commencer.</p>
        </div>
        <Button size="sm" onClick={() => void registerCase()} disabled={registering}>
          {registering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderPlus className="h-3.5 w-3.5" />}
          Enregistrer un dossier
        </Button>
        {registerError && <p className="text-xs text-destructive">{registerError}</p>}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-4 py-3">
        <select
          value={selectedCaseId ?? ''}
          onChange={(event) => selectCase(event.target.value || null)}
          className="h-9 min-w-40 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {cases.map((entry) => (
            <option key={entry.path} value={entry.path}>
              {entry.name}
            </option>
          ))}
        </select>
        <Button variant="ghost" size="sm" onClick={() => void registerCase()} disabled={registering}>
          {registering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderPlus className="h-3.5 w-3.5" />}
          Enregistrer un dossier
        </Button>
        {selectedCase && (
          <Button variant="ghost" size="sm" onClick={() => void revealCaseFolder()}>
            <FolderOpen className="h-3.5 w-3.5" /> Afficher dans le gestionnaire de fichiers
          </Button>
        )}
        {selectedCase && <span className="truncate text-xs text-muted-foreground">{selectedCase.location}</span>}
        {registerError && <span className="text-xs text-destructive">{registerError}</span>}
      </div>

      {!selectedCaseId ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Sélectionnez un dossier.</div>
      ) : overviewLoading && !overview ? (
        <div className="flex flex-1 items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement du dossier…
        </div>
      ) : overviewError ? (
        <div className="mx-auto max-w-md py-16 text-center text-sm">
          <p className="text-destructive">{overviewError}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void loadOverview()}>
            Réessayer
          </Button>
        </div>
      ) : overview ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 px-4 pt-3">
            <PillBar className="border border-border/40 bg-muted/50">
              <Pill isActive={view === 'pieces'} onClick={() => setView('pieces')}>
                <FileStack className="h-3.5 w-3.5" />
                Pièces ({overview.originals.length})
              </Pill>
              <Pill isActive={view === 'chronologie'} onClick={() => setView('chronologie')}>
                <CalendarClock className="h-3.5 w-3.5" />
                Chronologie
              </Pill>
            </PillBar>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {view === 'pieces' && (
              <CaseFilesOriginals caseId={selectedCaseId} mapping={overview.mapping} onRepositoryChange={() => void loadOverview()} />
            )}
            {view === 'chronologie' && <CaseFilesChronology caseId={selectedCaseId} caseName={overview.name} />}
          </div>
        </div>
      ) : null}
    </div>
  );
}
