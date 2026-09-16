import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { invalidatePmGet, PieceMakerApiError } from '@/piecemaker/dossier/api';
import { ensureDossierRegistration, refreshDossierRegistration, type DossierCase } from '@/piecemaker/dossier/dossierRegistration';

export type { DossierCase } from '@/piecemaker/dossier/dossierRegistration';

type DossierContextValue = {
  projectId: string | null;
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

type DossierCasesSnapshot = { cases: DossierCase[]; selectedCaseId: string | null };

const DOSSIER_CASES_SNAPSHOT_MAX_ENTRIES = 32;
const dossierCasesSnapshots = new Map<string, DossierCasesSnapshot>();

function dossierCasesSnapshotKey(projectPath: string | null | undefined): string {
  return projectPath ?? '';
}

function readDossierCasesSnapshot(projectPath: string | null | undefined): DossierCasesSnapshot | null {
  return dossierCasesSnapshots.get(dossierCasesSnapshotKey(projectPath)) ?? null;
}

function writeDossierCasesSnapshot(projectPath: string | null | undefined, snapshot: DossierCasesSnapshot): void {
  const key = dossierCasesSnapshotKey(projectPath);
  dossierCasesSnapshots.delete(key);
  dossierCasesSnapshots.set(key, snapshot);
  while (dossierCasesSnapshots.size > DOSSIER_CASES_SNAPSHOT_MAX_ENTRIES) {
    const oldestKey = dossierCasesSnapshots.keys().next().value;
    if (oldestKey === undefined) break;
    dossierCasesSnapshots.delete(oldestKey);
  }
}

export function DossierCasesProvider({
  projectId,
  projectPath,
  children,
}: {
  projectId?: string | null;
  projectPath?: string | null;
  children: ReactNode;
}) {
  const initialDossierCasesSnapshot = readDossierCasesSnapshot(projectPath);
  const [cases, setCases] = useState<DossierCase[]>(initialDossierCasesSnapshot?.cases ?? []);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(initialDossierCasesSnapshot?.selectedCaseId ?? null);
  const [loading, setLoading] = useState(initialDossierCasesSnapshot === null);
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
      const refreshedSelectedCaseId = selectedCase?.path ?? null;
      setCases(refreshedCases);
      setSelectedCaseId(refreshedSelectedCaseId);
      writeDossierCasesSnapshot(projectPath, { cases: refreshedCases, selectedCaseId: refreshedSelectedCaseId });
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
    projectId: projectId ?? null,
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
  }), [projectId, cases, selectedCaseId, refreshCases, loading, error, projectPath, mappingVersion, bumpMappingVersion]);

  return <DossierCasesContext.Provider value={value}>{children}</DossierCasesContext.Provider>;
}

/** Reads the shared case selection. Throws outside the Dossier tab, which is the only mount point. */
export function useDossierCases(): DossierContextValue {
  const value = useContext(DossierCasesContext);
  if (!value) throw new Error('useDossierCases must be used inside the Dossier tab.');
  return value;
}
