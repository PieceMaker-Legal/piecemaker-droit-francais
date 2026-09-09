import { invalidatePmGet, pmGet, pmPost } from '@/piecemaker/dossier/api';

export type DossierCase = {
  path: string;
  name: string;
  location: string;
  registered: boolean;
};

type RepositoryOverview = { folders?: DossierCase[] };
type RegisterSelectedCaseResult = { folder: DossierCase };
type DossierRegistration = { cases: DossierCase[]; selectedCase: DossierCase | null };

const REGISTRATION_MAX_AGE_MS = 30_000;
const REGISTRATION_MAX_ENTRIES = 32;
const registrations = new Map<string, { request: Promise<DossierRegistration>; resolvedAt: number | null }>();

async function registerDossier(projectPath: string | null | undefined): Promise<DossierRegistration> {
  const overview = await pmGet<RepositoryOverview>('/repository');
  const cases = overview.folders ?? [];
  if (!projectPath) return { cases, selectedCase: null };
  const existingCase = cases.find((entry) => entry.location === projectPath);
  if (existingCase) return { cases, selectedCase: existingCase };
  const registered = await pmPost<RegisterSelectedCaseResult>('/repository/cases/selected', { folder: projectPath });
  const selectedCase = registered.folder;
  return {
    cases: [...cases.filter((entry) => entry.path !== selectedCase.path), selectedCase],
    selectedCase,
  };
}

export function ensureDossierRegistration(projectPath?: string | null): Promise<DossierRegistration> {
  if (!projectPath) return registerDossier(projectPath);
  const existing = registrations.get(projectPath);
  if (existing && (existing.resolvedAt === null || Date.now() - existing.resolvedAt < REGISTRATION_MAX_AGE_MS)) {
    registrations.delete(projectPath);
    registrations.set(projectPath, existing);
    return existing.request;
  }
  registrations.delete(projectPath);
  const registration = registerDossier(projectPath)
    .then((value) => {
      const entry = registrations.get(projectPath);
      if (entry?.request === registration) entry.resolvedAt = Date.now();
      return value;
    })
    .catch((error) => {
      if (registrations.get(projectPath)?.request === registration) registrations.delete(projectPath);
      throw error;
    });
  registrations.set(projectPath, { request: registration, resolvedAt: null });
  while (registrations.size > REGISTRATION_MAX_ENTRIES) {
    const oldestPath = registrations.keys().next().value;
    if (oldestPath === undefined) break;
    registrations.delete(oldestPath);
  }
  return registration;
}

export async function refreshDossierRegistration(projectPath?: string | null): Promise<DossierRegistration> {
  if (projectPath) registrations.delete(projectPath);
  const registration = await ensureDossierRegistration(projectPath);
  if (registration.selectedCase) {
    const caseQuery = { case: registration.selectedCase.path };
    invalidatePmGet('/repository/case', caseQuery);
    invalidatePmGet('/mapping', caseQuery);
    invalidatePmGet('/repository/chronology', caseQuery);
  }
  return registration;
}
