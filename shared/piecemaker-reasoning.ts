export type ReasoningValue = boolean | null;

export type ReasoningStatus = 'acquis' | 'exclu' | 'à établir' | 'contesté';

export type ReasoningIssue = { id: string; kind: 'erreur' | 'manque'; path: string; line: number | null; text: string };

export type ReasoningDismissal = { id: string; path: string; text: string; at: string };

export type ReasoningPieceReliability = { piece: string; reliable: boolean; at: string };

export type ReasoningSnapshot = {
  revision: number;
  updatedAt: string | null;
  code: string;
  annotated: Record<string, unknown> | null;
  issues: ReasoningIssue[];
  dismissed: ReasoningDismissal[];
  reliability: ReasoningPieceReliability[];
  demo?: boolean;
};
