/**
 * Selected legal case file, shared by every section of the Dossier tab.
 *
 * The PieceMaker backend addresses a case by its registry id (`folder.path` in
 * `GET /repository`), not by the CloudCLI project path: a case is registered once
 * from the panel and then referenced by id. When the open CloudCLI project happens
 * to sit inside a registered case, that case is preselected.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { pmGet, PieceMakerApiError } from './api';

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

  const refreshCases = useCallback(async () => {
    setLoading(true);
    try {
      const overview = await pmGet<RepositoryOverview>('/repository');
      setCases(overview.folders ?? []);
      setError(null);
    } catch (cause) {
      setCases([]);
      setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCases();
  }, [refreshCases]);

  // Preselect the case containing the open project, else the first one. Runs
  // whenever the list changes so a freshly registered case becomes selectable.
  useEffect(() => {
    setSelectedCaseId((current) => {
      if (current && cases.some((entry) => entry.path === current)) return current;
      const containing = projectPath
        ? cases.find((entry) => projectPath === entry.location || projectPath.startsWith(`${entry.location}/`))
        : undefined;
      return containing?.path ?? cases[0]?.path ?? null;
    });
  }, [cases, projectPath]);

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
