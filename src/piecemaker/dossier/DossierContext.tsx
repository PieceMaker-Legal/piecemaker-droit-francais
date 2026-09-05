import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { PieceMakerApiError, pmGet, pmPost } from '@/piecemaker/dossier/api';

/** One registered case file, as listed by `GET /repository`. */
export type DossierCase = {
  /** Registry id, passed back as the `case` query parameter. */
  path: string;
  name: string;
  /** Absolute folder on disk. */
  location: string;
  registered: boolean;
};

type RepositoryOverview = { folders?: DossierCase[] };

type RegisterSelectedCaseResult = { folder: DossierCase };

type DossierContextValue = {
  cases: DossierCase[];
  selectedCaseId: string | null;
  selectedCase: DossierCase | null;
  selectCase: (caseId: string | null) => void;
  refreshCases: () => Promise<void>;
  loading: boolean;
  error: string | null;
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
  const refreshSequence = useRef(0);

  const refreshCases = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setLoading(true);
    try {
      const overview = await pmGet<RepositoryOverview>('/repository');
      let refreshedCases = overview.folders ?? [];
      let selectedCase = projectPath
        ? refreshedCases.find((entry) => projectPath === entry.location)
        : undefined;
      if (projectPath && !selectedCase) {
        const registered = await pmPost<RegisterSelectedCaseResult>('/repository/cases/selected', { folder: projectPath });
        const registeredCase = registered.folder;
        selectedCase = registeredCase;
        refreshedCases = [...refreshedCases.filter((entry) => entry.path !== registeredCase.path), registeredCase];
      }
      if (sequence !== refreshSequence.current) return;
      setCases(refreshedCases);
      setSelectedCaseId(selectedCase?.path ?? null);
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

  useEffect(() => {
    void refreshCases();
  }, [refreshCases]);

  const value = useMemo<DossierContextValue>(() => ({
    cases,
    selectedCaseId,
    selectedCase: cases.find((entry) => entry.path === selectedCaseId) ?? null,
    selectCase: setSelectedCaseId,
    refreshCases,
    loading,
    error,
  }), [cases, selectedCaseId, refreshCases, loading, error]);

  return <DossierCasesContext.Provider value={value}>{children}</DossierCasesContext.Provider>;
}

/** Reads the shared case selection. Throws outside the Dossier tab, which is the only mount point. */
export function useDossierCases(): DossierContextValue {
  const value = useContext(DossierCasesContext);
  if (!value) throw new Error('useDossierCases must be used inside the Dossier tab.');
  return value;
}
