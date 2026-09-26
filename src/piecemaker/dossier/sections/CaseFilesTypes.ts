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

/** GET/PUT /protection/bypass: case-wide protection lift and the snapshot kept to undo it. */
export type ProtectionBypassState = {
  case: string;
  active: boolean;
  savedAt: string | null;
  savedCount: number;
  unprotectedCount: number;
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

export type ChronologyExportFormat = 'pdf' | 'docx';
