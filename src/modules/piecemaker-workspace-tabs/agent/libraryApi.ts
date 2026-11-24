import { requestJson } from '@/shared/authToken';

export type LibraryConcept = { id: string; type: string; title: string; description: string; domaine: string; status: string; dossier: string };
export type LibraryTemplate = LibraryConcept & { resource: string; projects: string[]; guidelines: string[] };
export type Library = {
  repository: string;
  path: string;
  present: boolean;
  last_sync: string | null;
  syncError?: string | null;
  generated: { clients: number; projects: number };
  concepts: LibraryConcept[];
  edges: Array<{ from: string; to: string }>;
  templates: LibraryTemplate[];
};

const BASE = '/api/piecemaker/legal-okf';

export const libraryApi = {
  read: () => requestJson<Library>(BASE),
  sync: () => requestJson<Library>(`${BASE}/sync`, {}),
  concept: (id: string) => requestJson<{ id: string; content: string }>(`${BASE}/concept?id=${encodeURIComponent(id)}`),
  save: (id: string, content: string) => requestJson<{ id: string; content: string }>(`${BASE}/concept`, { id, content }, 'PUT'),
  link: (project: string, target: string, attach: boolean) => requestJson<Library>(`${BASE}/link`, { project, target, attach }, 'PUT'),
};
