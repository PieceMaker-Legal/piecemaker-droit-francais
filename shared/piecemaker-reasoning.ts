export type ReasoningPeriod = { from: string; to: string | null };

export type ReasoningDuration = { ans: number; mois: number; jours: number };
export type ReasoningValue = boolean | number | string | ReasoningDuration | null;

export const REASONING_FORCES = ['acte_authentique', 'acte_sous_seing_privé', 'commencement_de_preuve', 'indice', 'sans_valeur'] as const;
export type ReasoningForce = typeof REASONING_FORCES[number];

export type ReasoningHistory = { status: 'non remise en cause' | 'remise en cause' | 'à examiner'; lines: string[] };

export type ReasoningSource = {
  id: string;
  kind: 'article' | 'case' | 'document';
  document: string;
  title: string;
  excerpt: string;
  token: string;
  verified: boolean;
  repaired: boolean;
  proposedExcerpt?: string;
  validity?: ReasoningPeriod;
  history?: ReasoningHistory;
};

export type ReasoningReview = { status: 'validé' | 'écarté'; at: string; note?: string };

export type ReasoningCondition = {
  id: string;
  scope: string;
  variable: string;
  label: string;
  code: string;
  sources: string[];
  strength: 'loi' | 'jurisprudence' | 'doctrine' | null;
  dependsOn: string[];
  value: ReasoningValue;
  status: 'remplie' | 'non remplie' | 'indéterminée' | 'bloquée';
  issues: string[];
  review?: ReasoningReview;
};

export type ReasoningFact = {
  id: string;
  scope: string;
  variable: string;
  type: string;
  value: ReasoningValue;
  force: ReasoningForce | null;
  appreciation: string;
  author: 'ia' | 'avocat';
  sources: string[];
  status: 'établi' | 'non établi';
  burden?: 'nous' | 'adversaire';
  issues: string[];
  review?: ReasoningReview;
};

export type ReasoningVigueur = { source: string; date: string | null; inForce: boolean | null };

export type ReasoningVoie = {
  label: string;
  code: string;
  favorable: boolean;
  status: 'ouverte' | 'à établir' | 'fermée' | 'bloquée';
  strength: 'loi' | 'jurisprudence' | 'doctrine' | null;
  conditions: string[];
  toProve: string[];
  weaknesses: string[];
};

export type ReasoningQuestion = {
  scope: string;
  question: string;
  result: string;
  value: ReasoningValue;
  status: 'remplie' | 'non remplie' | 'indéterminée' | 'bloquée';
  referenceDate: string | null;
  vigueur: ReasoningVigueur[];
  conditions: string[];
  facts: string[];
  valid: boolean;
  issues: string[];
  objective: boolean | null;
  objectiveStatus: 'atteint' | 'à établir' | 'hors d’atteinte' | null;
  voies: ReasoningVoie[];
};

export type ReasoningFinding = { level: 'ok' | 'alerte'; subject: string; text: string };

export type ReasoningLogEntry = { key: string; step: 'théorie' | 'source' | 'registre' | 'fait' | 'règle' | 'vigueur' | 'réponse'; status: 'en cours' | 'ok' | 'alerte' | 'neutre'; subject: string; text: string; code?: string };

export type ReasoningTestReport = { at: string; findings: ReasoningFinding[]; log?: ReasoningLogEntry[] };

export type ReasoningSnapshot = {
  revision: number;
  updatedAt: string | null;
  code: string;
  sources: ReasoningSource[];
  questions: ReasoningQuestion[];
  conditions: ReasoningCondition[];
  facts: ReasoningFact[];
  test: ReasoningTestReport | null;
  diagnostics: string[];
  demo?: boolean;
};
