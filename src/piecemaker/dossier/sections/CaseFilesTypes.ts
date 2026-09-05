/**
 * Shared shapes for the "Dossiers" section, mirrored from the backend contracts
 * in `server/piecemaker/vendor/websocket-server/admin-routes.cjs` and the helpers
 * it calls (`commits.cjs`, `originals-pipeline.cjs`, `legal-chronology.cjs`,
 * `document-index.cjs`). Kept local to `sections/` rather than in
 * `src/shared/types.ts`: this task may only touch files under
 * `src/piecemaker/dossier/sections/`.
 */

/** One original piece, as returned by `originalFilesOverview()` (GET /repository/case, GET /protection). */
export type CaseFileEntry = {
  name: string;
  path: string;
  extension: string;
  size: number;
  modifiedAt: string;
  converted: boolean;
  scanned: boolean;
  protected: boolean;
  resource: boolean;
  status: 'ready' | 'awaiting-scan' | 'not-converted';
  /** Only present from GET /protection (via listOriginals): excludes correspondence/data-room outside the pipeline. */
  pipelineEligible?: boolean;
};

/** Three-state protection model computed from `protected` + `resource` (see admin app.js PIECE_STATES). */
export type PieceProtectionState = 'vault' | 'workspace' | 'resource';

export type CaseMappingSummary = {
  exists: boolean;
  name: string;
  entries: number;
};

/** GET /repository/case */
export type CaseOverview = {
  name: string;
  path: string;
  location: string;
  registered: boolean;
  originals: CaseFileEntry[];
  protectedOriginals: number;
  mapping: CaseMappingSummary;
};

/** POST /repository/cases */
export type RegisterCaseResult = {
  ok: true;
  cancelled?: boolean;
  folder?: CaseOverview;
  installed?: {
    claudeAssets: boolean;
    rule: string;
    mapping: string;
    protection: string;
    structure: string[];
    commit: string | null;
  };
};

/** GET /protection */
export type ProtectionOverview = {
  case: string;
  files: CaseFileEntry[];
  protectedCount: number;
  resourceCount: number;
  truncated: boolean;
};

/** PUT /protection */
export type ProtectionSaveResult = {
  ok: true;
  case: string;
  unprotected: string[];
  resources: string[];
};

export type OriginalsPipelineAction = 'convert' | 'anonymize';

/** GET/DELETE /originals/job, and the `job` embedded in POST /originals/pipeline. */
export type OriginalsJob = {
  id: string;
  case: string;
  action: OriginalsPipelineAction;
  state: 'queued' | 'running' | 'done' | 'error';
  phase?: string;
  percent?: number;
  processed?: number;
  total?: number;
  skipped?: number;
  files?: string[];
  log?: string[];
  error?: string | null;
  cancelled?: boolean;
  queuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  queuePosition?: number;
  reference?: string;
};

export type ChronologyField = { label: string; value: string };

/** One projected document inside the chronology (chronologyFromLegalGraph()). */
export type ChronologyDocument = {
  documentKey: string;
  id: string;
  path: string | null;
  name: string;
  resource: boolean;
  scanned: boolean;
  analyzable: boolean;
  indexed: boolean;
  edited: boolean;
  nature: string | null;
  date: string | null;
  dateIso: string | null;
  juridiction: string | null;
  fields: ChronologyField[];
  reviewRequired: boolean;
  reviewReasons: string[];
};

/** The raw semantic-layer status, exposed as `graph.state` (see legal-graph.cjs legalGraphStatus()). */
export type ChronologyGraphState = {
  staticState?: string;
  semanticState?: string;
  semanticStaleReasons?: string[];
  semanticQuarantined?: boolean;
  staticRevision?: number | null;
  semanticBaseRevision?: number | null;
};

/** Legacy, simpler status string computed by legacyGraphStatus() — what the frise badge shows. */
export type ChronologyLegacyStatus = 'ready' | 'stale' | 'building' | 'failed' | 'blocked' | 'empty';

export type ChronologyGraph = {
  status: ChronologyLegacyStatus;
  state: ChronologyGraphState;
  revision: number | null;
};

/** GET /repository/chronology */
export type ChronologyOverview = {
  generatedAt: string;
  graphRevision: number | null;
  mapping: { exists: boolean; entries: number };
  stats: {
    documents: number;
    indexed: number;
    dated: number;
    entities: number;
    span: { from: string; to: string } | null;
  };
  documents: ChronologyDocument[];
  datedDocuments: ChronologyDocument[];
  undatedDocuments: ChronologyDocument[];
  graph: ChronologyGraph;
  case: { path: string; name: string; location: string };
};

/** POST /repository/legal-graph/refresh */
export type LegalGraphRefreshResult = {
  ok: true;
  graph: ChronologyGraphState & { exists: boolean; generatedAt?: string };
};

/** Body of PUT /repository/document-meta — always the full effective values, never a partial diff. */
export type DocumentMetaCorrection = {
  case: string;
  path: string;
  nature: string | null;
  dateIso: string | null;
  juridiction: string | null;
  fields: ChronologyField[];
};

export type ChronologyExportFormat = 'pdf' | 'docx';

export type RevealTarget = 'files' | 'terminal';
