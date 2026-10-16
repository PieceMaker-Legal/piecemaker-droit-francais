export type ReasoningValue = string | number | boolean | null;

export type ReasoningExpression = ReasoningValue | { ref: string } | {
  op: 'and' | 'or' | 'not' | 'equal' | 'greater' | 'atLeast' | 'less' | 'atMost' | 'add' | 'subtract' | 'multiply' | 'divide' | 'if';
  args: ReasoningExpression[];
};

export type ReasoningNode = {
  id: string;
  kind: 'fact' | 'rule' | 'calculation' | 'conclusion';
  label: string;
  state?: 'asserted' | 'disputed' | 'unknown';
  value?: ReasoningValue;
  expression?: ReasoningExpression;
  citations?: number[];
  sources: string[];
  rationale?: string;
  requiresReview?: boolean;
};

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
};

export type ReasoningScenario = { id: string; label: string; assumptions: Record<string, ReasoningValue> };
export type ReasoningTest = {
  id: string;
  label: string;
  target: string;
  scenario?: string;
  expected: { status: 'known' | 'unknown' | 'blocked' | 'error'; value?: ReasoningValue };
};

export type ReasoningProgram = {
  version: 1;
  nodes: ReasoningNode[];
  sources: ReasoningSource[];
  scenarios: ReasoningScenario[];
  tests: ReasoningTest[];
};

export type ReasoningResult = {
  id: string;
  status: 'known' | 'unknown' | 'blocked' | 'error';
  value: ReasoningValue;
  dependencies: string[];
  missing: string[];
  assumptions: string[];
  issues: string[];
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
  demo?: boolean;
};
