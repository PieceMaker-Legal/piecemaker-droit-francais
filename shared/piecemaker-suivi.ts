import type { ReasoningIssue } from './piecemaker-reasoning.js';

export type SuiviProof = { piece: string; citation: string; titre?: string };

export type SuiviBasis = { source: string; citation: string; titre?: string };

export type SuiviEvent = { nom: string; intitule: string; date: string; suppose: boolean; preuve: SuiviProof[]; selon: SuiviBasis[] };

export type SuiviDone = { date: string; preuve: SuiviProof[]; par: 'fichier' | 'avocat'; piece?: string | null; at?: string };

export type SuiviDeadline = {
  nom: string;
  intitule: string;
  date: string | null;
  calcul: string[];
  fixe: boolean;
  suppose: boolean;
  preuve: SuiviProof[];
  selon: SuiviBasis[];
  decompte: SuiviBasis[];
  fait: SuiviDone | null;
  erreurs: number;
  manques: number;
};

export type SuiviSnapshot = {
  revision: number;
  updatedAt: string | null;
  code: string;
  hash: string | null;
  evenements: SuiviEvent[];
  echeances: SuiviDeadline[];
  issues: ReasoningIssue[];
  stale?: boolean;
  absent?: boolean;
};

export type SuiviDossier = { projectPath: string; nom: string; session: string | null; snapshot: SuiviSnapshot };
