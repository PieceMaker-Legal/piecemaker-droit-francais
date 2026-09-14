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

/** GET/PUT /protection/bypass: case-wide protection lift and the snapshot kept to undo it. */
export type ProtectionBypassState = {
  case: string;
  active: boolean;
  savedAt: string | null;
  savedCount: number;
  unprotectedCount: number;
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

export type ChronologyEntity = {
  code: string;
  category: string;
  label: string | null;
};

export type ChronologyEntityDecisions = {
  additions: string[];
  exclusions: string[];
};

export type ChronologyDocument = {
  documentKey: string;
  id: string;
  path: string | null;
  name: string;
  resource: boolean;
  scanned: boolean;
  indexed: boolean;
  edited: boolean;
  nature: string | null;
  date: string | null;
  dateIso: string | null;
  localisation: string | null;
  fields: ChronologyField[];
  codes: ChronologyEntity[];
  detectedCodes: ChronologyEntity[];
  entityDecisions: ChronologyEntityDecisions;
};

/** GET /repository/chronology */
export type ChronologyOverview = {
  generatedAt: string;
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
  scope?: string | null;
  folders?: string[];
  case: { path: string; name: string; location: string };
};

/** Body of PUT /repository/document-meta — always the full effective values, never a partial diff. */
export type DocumentMetaCorrection = {
  case: string;
  path: string;
  nature: string | null;
  dateIso: string | null;
  localisation: string | null;
  fields: ChronologyField[];
};

export type ChronologyExportFormat = 'pdf' | 'docx';

export type RevealTarget = 'files' | 'terminal';
