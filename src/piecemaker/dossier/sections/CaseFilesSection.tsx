/**
 * "Dossiers" section of the Dossier tab: register/select a legal case, then
 * drill into its original pieces (protection + conversion + anonymization) or
 * its chronology. Rebuilds, in CloudCLI style, the case-file administration of
 * PieceMaker-Installer's admin/ (index.html + app.js) against the routes now
 * mounted on the CloudCLI server under /api/piecemaker.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderPlus, FolderSearch, Loader2 } from 'lucide-react';

import { Button } from '@/shared/ui';
import { useDossierCases } from '@/piecemaker/dossier/DossierContext';
import { pmGetCached, pmPost, PieceMakerApiError } from '@/piecemaker/dossier/api';
import type { CaseOverview, RegisterCaseResult } from '@/piecemaker/dossier/sections/CaseFilesTypes';
import CaseMappingSection from '@/piecemaker/dossier/sections/CaseMappingSection';

export default function CaseFilesSection() {
  const { cases, selectedCaseId, selectCase, refreshCases, loading, error, mappingVersion, bumpMappingVersion } = useDossierCases();
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  const [overview, setOverview] = useState<CaseOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const overviewRequestSequence = useRef(0);

  const loadOverview = useCallback(async () => {
    const requestSequence = ++overviewRequestSequence.current;
    if (!selectedCaseId) {
      setOverview(null);
      setOverviewLoading(false);
      setOverviewError(null);
      return;
    }
    setOverviewLoading(true);
    try {
      const { folder } = await pmGetCached<{ folder: CaseOverview }>('/repository/case', { case: selectedCaseId });
      if (requestSequence !== overviewRequestSequence.current) return;
      setOverview(folder);
      setOverviewError(null);
    } catch (cause) {
      if (requestSequence !== overviewRequestSequence.current) return;
      setOverview(null);
      setOverviewError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      if (requestSequence === overviewRequestSequence.current) setOverviewLoading(false);
    }
  }, [selectedCaseId]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview, mappingVersion]);

  const handleRepositoryChange = useCallback(async () => {
    bumpMappingVersion();
  }, [bumpMappingVersion]);

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
      {!selectedCaseId ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Le dossier sélectionné dans la barre latérale n'est pas enregistré comme dossier juridique.
        </div>
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
        <div className="min-h-0 flex-1 overflow-y-auto">
          <CaseMappingSection caseId={selectedCaseId} refreshVersion={mappingVersion} onRepositoryChange={handleRepositoryChange} />
        </div>
      ) : null}
    </div>
  );
}
