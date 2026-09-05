import { pmGet, pmPost } from '@/piecemaker/dossier/api';

export type DossierCase = {
  path: string;
  name: string;
  location: string;
  registered: boolean;
};

type RepositoryOverview = { folders?: DossierCase[] };
type RegisterSelectedCaseResult = { folder: DossierCase };
type DossierRegistration = { cases: DossierCase[]; selectedCase: DossierCase | null };

const registrations = new Map<string, Promise<DossierRegistration>>();

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
  const pending = registrations.get(projectPath);
  if (pending) return pending;
  const registration = registerDossier(projectPath).finally(() => registrations.delete(projectPath));
  registrations.set(projectPath, registration);
  return registration;
}
