export type SuiviIssue = { id: string; kind: 'erreur' | 'manque' | 'conseil'; path: string; line: number | null; text: string; regle?: string; correction?: string; avocat?: string; cible?: string; ailleurs?: Array<{ path: string; line: number | null }> };

export type SuiviProof = { piece: string; citation: string; titre?: string };

export type SuiviBasis = { source: string; citation: string; titre?: string };

export type SuiviEvent = { nom: string; intitule: string; date: string; suppose: boolean; preuve: SuiviProof[]; selon: SuiviBasis[] };

export type SuiviDone = { date: string; preuve: SuiviProof[]; par: 'fichier' | 'avocat'; piece?: string | null; at?: string };

export type SuiviDeadline = {
  nom: string;
  intitule: string;
  kind: string;
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
  issues: SuiviIssue[];
  stale?: boolean;
  absent?: boolean;
};

export type SuiviDossier = { projectPath: string; fichier: string; nom: string; session: string | null; snapshot: SuiviSnapshot };
