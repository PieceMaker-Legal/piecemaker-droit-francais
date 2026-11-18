import { authenticatedFetch, requestJson } from '../../../src/shared/authToken.js';
import type { SuiviDossier, SuiviSnapshot } from '../../../shared/piecemaker-suivi.js';

const BOARD_PAGE = '/api/plugins/piecemaker-echeances/assets/board/index.html';
const ETAPES = '/api/piecemaker/etapes';

export type Etape = 'preparation' | 'raisonnement' | 'redaction' | 'finalisation' | 'attente' | 'clos';
export type Ligne = { nom: string; texte: string; ok: boolean };
export type DocumentRedige = { type: string; nom: string; chemin: string; valide?: boolean; statut?: 'validé' | 'en cours' | 'non commencé' };
export type Action = { texte: string; fait: boolean; echeance?: string; suivi?: string };
export type TacheStatut = 'attente' | 'en-cours' | 'question' | 'terminee' | 'echec';
export type Demande = { requestId: string; toolName: string; input: Record<string, unknown> };
export type Carte = {
  id: string;
  projectPath: string;
  dossier: string;
  session: string | null;
  matter?: string | null;
  etape: Etape;
  exclu?: boolean;
  preparation?: Ligne[];
  mappingValide?: string | null;
  aDemarrer?: boolean;
  raisonnement?: { nom: string; titre: string; qualification?: string | null; acte?: string | null; objectifs?: string[]; verifie: boolean; erreurs: number; manques: number; alertes: { kind: 'erreur' | 'manque'; texte: string }[] };
  documents?: DocumentRedige[];
  action?: Action | null;
  historique?: { nom: string; documents: DocumentRedige[] }[];
  tache?: { id: string; statut: TacheStatut; titre: string; sessionId: string | null } | null;
};
export type Tache = {
  id: string;
  projectPath: string;
  dossier: string;
  raisonnement: string | null;
  titre: string;
  provider: string;
  model: string;
  auto: boolean;
  statut: TacheStatut;
  sessionId: string | null;
  creeLe: string;
  erreur: string | null;
  question?: string | null;
  demandes?: Demande[];
};
export type Fiche = {
  summary?: string;
  client?: string;
  practiceArea?: string;
  responsible?: string;
  openedOn?: string;
  parties?: { name?: string; role?: string }[];
  nextStep?: { text?: string; due?: string; owner?: string } | null;
  keyDates?: { label?: string; date?: string; done?: boolean; source?: string; quote?: string; kind?: string }[];
  status?: string;
  lastActivityOn?: string;
  origin?: string;
  checked?: unknown;
  proposedDates?: unknown;
};
export type TypeDocument = { nom: string; skill: string; modele?: string };
export type NouvelleTache = { type: string; projectPath: string; raisonnement?: string; document?: number; piece?: string; provider: string; model: string; instructions: string; auto: boolean };

export function loadAll(): Promise<SuiviDossier[]> {
  return request<SuiviDossier[]>('/api/piecemaker/suivi/tous');
}

export function loadBoard(rev: string): Promise<{ rev: string; docs?: Record<string, unknown> }> {
  return request(`/api/piecemaker/suivi/board${rev ? `?${query({ rev })}` : ''}`);
}

export function verifySuivi(projectPath: string, suivi: string): Promise<SuiviSnapshot> {
  return request<SuiviSnapshot>('/api/piecemaker/suivi/verify', { projectPath, suivi });
}

export async function loadBoardPage(): Promise<string> {
  const response = await authenticatedFetch(BOARD_PAGE);
  if (!response.ok) throw new Error(`Erreur ${response.status}`);
  return response.text();
}

const query = (values: Record<string, string>) => new URLSearchParams(values).toString();

export const etapes = {
  tableau: (frais = false) => request<{ cartes: Carte[] }>(`${ETAPES}${frais ? '?frais=1' : ''}`),
  dossier: (body: { projectPath: string; nonJuridique?: boolean; etape?: Etape }) => request(`${ETAPES}/dossier`, body),
  raisonnement: (body: { projectPath: string; raisonnement: string; etape?: Etape; documents?: DocumentRedige[]; action?: Partial<Action> }) => request(`${ETAPES}/raisonnement`, body),
  reprise: (projectPath: string, raisonnement: string) => request<{ raisonnement: string }>(`${ETAPES}/reprise`, { projectPath, raisonnement }),
  piece: (projectPath: string, file: File) => request<{ chemin: string }>(`${ETAPES}/piece?${query({ projectPath, nom: file.name })}`, file),
  modele: (file: File) => request<{ chemin: string }>(`${ETAPES}/modele?${query({ nom: file.name })}`, file),
  types: (projectPath: string) => request<TypeDocument[]>(`${ETAPES}/types?${query({ projectPath })}`),
  ajouterType: (body: { nom: string; modele?: string }) => request<TypeDocument[]>(`${ETAPES}/types`, body),
  taches: () => request<Tache[]>(`${ETAPES}/taches`),
  ajouterTache: (body: NouvelleTache) => request<Tache>(`${ETAPES}/taches`, body),
  lancer: (id: string) => request<Tache>(`${ETAPES}/taches/${encodeURIComponent(id)}/lancer`, {}),
  auto: (id: string, auto: boolean) => request<Tache>(`${ETAPES}/taches/${encodeURIComponent(id)}/auto`, { auto }),
  repondre: (id: string, texte: string) => request<Tache>(`${ETAPES}/taches/${encodeURIComponent(id)}/repondre`, { texte }),
  decision: (id: string, body: { requestId: string; allow: boolean; updatedInput?: unknown }) => request<Tache>(`${ETAPES}/taches/${encodeURIComponent(id)}/decision`, body),
  terminer: (id: string) => request<Tache>(`${ETAPES}/taches/${encodeURIComponent(id)}/terminer`, {}),
  retirer: (id: string) => request(`${ETAPES}/taches/${encodeURIComponent(id)}`, undefined, 'DELETE'),
  volet: (project: string, tab: string, document?: string) => request('/api/piecemaker/local/open-panel', { project, tab, ...(document ? { document } : {}) }),
};

const request = <T>(url: string, body?: object | Blob, method?: string): Promise<T> => requestJson<T>(url, body, method);
