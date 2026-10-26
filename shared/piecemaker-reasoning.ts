export type ReasoningValue = boolean | null;

export type ReasoningStatus = 'acquis' | 'exclu' | 'à établir' | 'disputé';

export type ReasoningIssue = { id: string; kind: 'erreur' | 'manque'; path: string; line: number | null; text: string; avocat?: string; cible?: string; ailleurs?: Array<{ path: string; line: number | null }> };

export type ReasoningDismissal = { id: string; path: string; text: string; at: string };

export type ReasoningPieceReliability = { piece: string; reliable: boolean; at: string };

export type ReasoningLogEntry = { key: string; step: 'source' | 'pièce' | 'fait' | 'condition' | 'essai' | 'registre' | 'réponse'; status: 'en cours' | 'ok' | 'alerte' | 'neutre'; subject: string; text: string };

export type ReasoningTestReport = { at: string; log: ReasoningLogEntry[] };

export type ReasoningSnapshot = {
  revision: number;
  updatedAt: string | null;
  code: string;
  annotated: Record<string, unknown> | null;
  issues: ReasoningIssue[];
  dismissed: ReasoningDismissal[];
  reliability: ReasoningPieceReliability[];
  test: ReasoningTestReport | null;
  demo?: boolean;
};
