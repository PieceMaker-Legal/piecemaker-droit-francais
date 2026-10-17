export type ReasoningValue = string | number | boolean | null;

export type ReasoningPeriod = { from: string; to: string | null };

export type ReasoningExpression = ReasoningValue | { ref: string } | {
  apply: string;
  bindings: Record<string, ReasoningExpression>;
  at: ReasoningExpression;
} | {
  op: 'and' | 'or' | 'not' | 'equal' | 'greater' | 'atLeast' | 'less' | 'atMost' | 'add' | 'subtract' | 'multiply' | 'divide' | 'if' | 'addDuration' | 'daysBetween';
  args: ReasoningExpression[];
};

export type ReasoningEvidence = { nature?: string[]; mentions?: string[]; from?: string; to?: string };
export type ReasoningEvidenceCandidate = { id: string; label: string; date: string | null; nature: string | null };
export type ReasoningReview = { decision: 'retained' | 'rejected'; at: string; note?: string };
export type ReasoningException = { id: string; label: string; when: ReasoningExpression; then: ReasoningExpression };
export type ReasoningProof = 'established' | 'unestablished' | 'to_examine' | 'disputed' | 'assumed';

export type ReasoningNode = {
  id: string;
  kind: 'fact' | 'rule' | 'calculation' | 'conclusion';
  label: string;
  layer?: 'law' | 'fact' | 'theory';
  state?: 'asserted' | 'disputed' | 'unknown' | 'reported';
  value?: ReasoningValue;
  expression?: ReasoningExpression;
  citations?: number[];
  sources: string[];
  rationale?: string;
  requiresReview?: boolean;
  parameters?: string[];
  validity?: ReasoningPeriod;
  relation?: { subject: string; predicate: string; object: string; context: string; unit?: string; eventDate?: string; documentDate?: string };
  input?: { table: 'piecemaker_nodes' | 'piecemaker_links' | 'piecemaker_citations'; where: Record<string, ReasoningValue>; column: string; path?: string };
  inputIssue?: string;
  burden?: string;
  evidence?: ReasoningEvidence;
  evidenceCandidates?: ReasoningEvidenceCandidate[];
  evidenceIssue?: string;
  conditions?: Record<string, { label: string; burden?: string }>;
  exceptions?: ReasoningException[];
  origin?: 'library';
  review?: ReasoningReview;
};

export type ReasoningLink = { id: string; from: string; to: string; relation: 'supports' | 'contradicts' | 'reports' | 'depends_on' | 'qualifies' | 'precedes'; rationale?: string };
export type ReasoningConflict = { kind: 'values' | 'contradiction' | 'chronology'; nodes: string[]; message: string };

export type ReasoningSource = {
  id: string;
  ref: number;
  quoteIndex: number;
  token: string;
  document: string;
  title: string;
  excerpt: string;
  hash: string;
  verified: boolean;
  repaired: boolean;
  stale?: boolean;
  validity?: ReasoningPeriod;
  nature?: 'document' | 'article' | 'case' | 'simulation';
  proposedExcerpt?: string;
};

export type ReasoningScenario = { id: string; label: string; assumptions: Record<string, ReasoningValue> };
export type ReasoningTest = {
  id: string;
  label: string;
  target: string;
  scenario?: string;
  rationale?: string;
  expected: { status: 'known' | 'unknown' | 'blocked' | 'error'; value?: ReasoningValue };
  review?: ReasoningReview;
};

export type ReasoningMatrixRow = {
  rule: string;
  parameter: string;
  label: string;
  burden?: string;
  facts: string[];
  status: 'established' | 'unestablished' | 'to_examine' | 'disputed' | 'assumed' | 'unknown' | 'blocked';
  pieces: string[];
  candidates: string[];
  objections: string[];
};

export type ReasoningTheory = {
  id: string;
  label: string;
  facts: string[];
  laws: string[];
  tests: string[];
  status: 'incomplete' | 'untested' | 'failing' | 'passing';
  issues: string[];
  validatedTests: number;
  matrix: ReasoningMatrixRow[];
};

export type ReasoningProgram = {
  version: 1;
  nodes: ReasoningNode[];
  sources: ReasoningSource[];
  scenarios: ReasoningScenario[];
  tests: ReasoningTest[];
  links?: ReasoningLink[];
};

export type ReasoningResult = {
  id: string;
  status: 'known' | 'unknown' | 'blocked' | 'error';
  value: ReasoningValue;
  dependencies: string[];
  missing: string[];
  assumptions: string[];
  issues: string[];
  unestablished?: string[];
  proof?: ReasoningProof;
};

export type ReasoningEvaluation = {
  scenario: string;
  results: ReasoningResult[];
  tests: Array<{ id: string; label: string; passed: boolean; expected: ReasoningTest['expected']; actual: ReasoningResult }>;
};

export type ReasoningSnapshot = {
  revision: number;
  updatedAt: string | null;
  program: ReasoningProgram;
  evaluations: ReasoningEvaluation[];
  changes: Array<{ id: string; scenario: string; before: string; after: string }>;
  diagnostics: string[];
  conflicts?: ReasoningConflict[];
  theories?: ReasoningTheory[];
  notes?: string[];
  demo?: boolean;
};

export type ReasoningDraftFinding = { kind: 'amount' | 'date' | 'reserve'; text: string; message: string };
export type ReasoningDraftCheck = { file: string; findings: ReasoningDraftFinding[]; checkedAmounts: number; checkedDates: number };
