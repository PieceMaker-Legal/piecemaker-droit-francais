export type Rule = {
  id: string;
  name: string;
  concept: string;
  required: boolean;
  standard: string;
  fallbacks: string[];
  unacceptable: string[];
  conditions: string[];
  guidance: string;
  suggestedClause: string;
  sourceRefs: string[];
};

export type Source = { id: string; text: string; location: string };
export type Playbook = {
  id: string;
  revision: string;
  name: string;
  representedParty: string;
  rules: Rule[];
  sources: Source[];
  sourcePath: string | null;
  sourceHash: string | null;
  validated: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FindingStatus = 'acceptable' | 'needs_review' | 'unacceptable' | 'missing_required' | 'not_applicable';
export type Finding = {
  id: string;
  ruleId: string;
  ruleName: string;
  status: FindingStatus;
  quote: string;
  location: string;
  analysis: string;
  suggestedText: string;
  insertAfter: string;
  verified: boolean;
  applied: boolean;
};

export type AiSettings = { provider: 'claude' | 'codex' | 'mistral'; model: string; proxyOrigin: string };
export type Run = {
  id: string;
  attempt: string;
  kind: 'import' | 'review';
  status: 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
  stage: string;
  error: string | null;
  playbook: Playbook | null;
  sourcePath: string;
  sourceHash: string;
  sourceText: string;
  sources: Source[];
  documentType: string;
  mode: 'strict' | 'permissive';
  summary: string;
  findings: Finding[];
  outputHash: string | null;
  settings: Pick<AiSettings, 'provider' | 'model'>;
  createdAt: string;
  updatedAt: string;
};

export type PluginApi = {
  readonly context: { theme: 'light' | 'dark'; project: { name: string; path: string } | null; session: { id: string; title: string } | null };
  onContextChange(callback: (context: PluginApi['context']) => void): () => void;
  rpc(method: string, path: string, body?: unknown): Promise<unknown>;
};
