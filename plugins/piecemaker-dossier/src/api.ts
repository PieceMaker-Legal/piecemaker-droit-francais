import type { KnowledgeSnapshot, KnowledgeUpdateOperation } from './types.js';

export type KnowledgeDocumentPreview = { path: string; content: string };
export type InstitutionalTerms = { file: string; terms: string[] };
export type ScanJob = {
  id: string;
  projectId: string;
  state: 'running' | 'done' | 'error' | 'cancelled';
  percent: number;
  error: string | null;
};
export type CompanyDirector = { name: string; role: string };
export type CompanySearchFields = {
  legalName: string;
  legalForm: string;
  status: string;
  siren: string;
  siret: string;
  vat: string;
  legalFormCode: string;
  naf: string;
  creationDate: string;
  category: string;
  address: string;
  directors: CompanyDirector[];
  finances: string[];
  source: string;
};
export type CompanySearchResult = {
  name: string;
  siren: string;
  summary: string;
  url: string;
  details: string;
  fields: CompanySearchFields;
};
export type BodaccAnnouncement = {
  id: string;
  datePublication: string;
  typeAvis: string;
  familleAvis: string;
  commercant: string;
  ville: string;
  tribunal: string;
  jugement: string;
  acte: string;
  url: string;
};
export type BodaccSearchResult = {
  siren: string;
  total: number;
  alertes: string[];
  annonces: BodaccAnnouncement[];
};
type RepositoryCase = { path: string; location: string };
type RepositoryOverview = { folders?: RepositoryCase[] };
type RegisteredCase = { folder: RepositoryCase };

const BASE = '/api/piecemaker/knowledge';
const PIECEMAKER_BASE = '/api/piecemaker';

async function request<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('auth-token');
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const refreshed = response.headers.get('X-Refreshed-Token');
  if (refreshed) {
    localStorage.setItem('auth-token', refreshed);
    window.dispatchEvent(new CustomEvent('auth-token-refreshed', { detail: refreshed }));
  }
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
  return data;
}

const query = (projectId: string): string => `?projectId=${encodeURIComponent(projectId)}`;
const caseReferences = new Map<string, Promise<string>>();

function caseReference(projectPath: string): Promise<string> {
  const existing = caseReferences.get(projectPath);
  if (existing) return existing;
  const pending = request<RepositoryOverview>(PIECEMAKER_BASE, '/repository')
    .then(async (overview) => {
      const registered = overview.folders?.find((entry) => entry.location === projectPath);
      if (registered) return registered.path;
      const result = await request<RegisteredCase>(PIECEMAKER_BASE, '/repository/cases/selected', { method: 'POST', body: JSON.stringify({ folder: projectPath }) });
      return result.folder.path;
    })
    .catch((error) => {
      caseReferences.delete(projectPath);
      throw error;
    });
  caseReferences.set(projectPath, pending);
  return pending;
}

export const knowledgeApi = {
  graph: (projectId: string) => request<KnowledgeSnapshot>(BASE, `/graph${query(projectId)}`),
  document: async (projectPath: string, path: string) => {
    if (!projectPath) throw new Error('Le chemin du dossier CloudCLI est indisponible.');
    const reference = await caseReference(projectPath);
    return request<KnowledgeDocumentPreview>(PIECEMAKER_BASE, `/repository/document?case=${encodeURIComponent(reference)}&path=${encodeURIComponent(path)}`);
  },
  scan: (projectId: string) => request<{ job: ScanJob }>(BASE, '/scan', { method: 'POST', body: JSON.stringify({ projectId }) }),
  scanJob: (jobId: string, projectId: string) => request<{ job: ScanJob | null }>(BASE, `/scan/job?id=${encodeURIComponent(jobId)}&projectId=${encodeURIComponent(projectId)}`),
  cancelScan: (jobId: string, projectId: string) => request<{ job: ScanJob | null }>(BASE, '/scan/cancel', { method: 'POST', body: JSON.stringify({ id: jobId, projectId }) }),
  searchCompanies: (queryText: string) => request<{ query: string; results: CompanySearchResult[] }>(PIECEMAKER_BASE, '/company-search', { method: 'POST', body: JSON.stringify({ query: queryText }) }),
  searchBodacc: (siren: string, siret: string) => request<BodaccSearchResult>(PIECEMAKER_BASE, '/bodacc-search', { method: 'POST', body: JSON.stringify({ siren, siret }) }),
  update: (projectId: string, operations: KnowledgeUpdateOperation[]) => request(BASE, '/update', { method: 'POST', body: JSON.stringify({ projectId, operations }) }),
  institutionalTerms: () => request<InstitutionalTerms>(PIECEMAKER_BASE, '/institutional-terms'),
  saveInstitutionalTerms: (terms: string[]) => request<InstitutionalTerms>(PIECEMAKER_BASE, '/institutional-terms', { method: 'PUT', body: JSON.stringify({ terms }) }),
};
