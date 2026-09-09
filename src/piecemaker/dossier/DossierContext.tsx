import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { invalidatePmGet, PieceMakerApiError } from '@/piecemaker/dossier/api';
import { ensureDossierRegistration, refreshDossierRegistration, type DossierCase } from '@/piecemaker/dossier/dossierRegistration';

export type { DossierCase } from '@/piecemaker/dossier/dossierRegistration';

type DossierContextValue = {
  cases: DossierCase[];
  selectedCaseId: string | null;
  selectedCase: DossierCase | null;
  selectCase: (caseId: string | null) => void;
  refreshCases: () => Promise<void>;
  loading: boolean;
  error: string | null;
  projectPath: string | null;
  mappingVersion: number;
  bumpMappingVersion: () => void;
};

const DossierCasesContext = createContext<DossierContextValue | null>(null);

export function DossierCasesProvider({
  projectPath,
  children,
}: {
  projectPath?: string | null;
  children: ReactNode;
}) {
  const [cases, setCases] = useState<DossierCase[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mappingVersion, setMappingVersion] = useState(0);
  const refreshSequence = useRef(0);
  const bumpMappingVersion = useCallback(() => {
    if (selectedCaseId) {
      const caseQuery = { case: selectedCaseId };
      invalidatePmGet('/repository/case', caseQuery);
      invalidatePmGet('/mapping', caseQuery);
      invalidatePmGet('/repository/chronology', caseQuery);
    }
    setMappingVersion((previous) => previous + 1);
  }, [selectedCaseId]);

  const loadCases = useCallback(async (refresh: boolean) => {
    const sequence = ++refreshSequence.current;
    setLoading(true);
    try {
      const { cases: refreshedCases, selectedCase } = refresh
        ? await refreshDossierRegistration(projectPath)
        : await ensureDossierRegistration(projectPath);
      if (sequence !== refreshSequence.current) return;
      setCases(refreshedCases);
      setSelectedCaseId(selectedCase?.path ?? null);
      if (refresh) setMappingVersion((previous) => previous + 1);
      setError(null);
    } catch (cause) {
      if (sequence !== refreshSequence.current) return;
      setCases([]);
      setSelectedCaseId(null);
      setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      if (sequence === refreshSequence.current) setLoading(false);
    }
  }, [projectPath]);

  const refreshCases = useCallback(() => loadCases(true), [loadCases]);

  useEffect(() => {
    void loadCases(false);
  }, [loadCases]);

  const value = useMemo<DossierContextValue>(() => ({
    cases,
    selectedCaseId,
    selectedCase: cases.find((entry) => entry.path === selectedCaseId) ?? null,
    selectCase: setSelectedCaseId,
    refreshCases,
    loading,
    error,
    projectPath: projectPath ?? null,
    mappingVersion,
    bumpMappingVersion,
  }), [cases, selectedCaseId, refreshCases, loading, error, projectPath, mappingVersion, bumpMappingVersion]);

  return <DossierCasesContext.Provider value={value}>{children}</DossierCasesContext.Provider>;
}

/** Reads the shared case selection. Throws outside the Dossier tab, which is the only mount point. */
export function useDossierCases(): DossierContextValue {
  const value = useContext(DossierCasesContext);
  if (!value) throw new Error('useDossierCases must be used inside the Dossier tab.');
  return value;
}
