export const NODE_KINDS = ['person', 'company', 'document', 'iban', 'address', 'phone', 'email', 'url', 'siren', 'other'] as const;
export const EXCLUSIONS_NODE_ID = 'system:gliner-exclusions';

export type NodeKind = (typeof NODE_KINDS)[number];
export type JsonData = Record<string, unknown>;

export type KnowledgeNodeInput = {
  id: string;
  kind: NodeKind;
  label?: string;
  aliases?: string[];
  data?: JsonData;
  date?: string | null;
};

export type KnowledgeNode = Omit<KnowledgeNodeInput, 'date'> & {
  projectId: string;
  label: string;
  aliases: string[];
  data: JsonData;
  date: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeLinkInput = {
  fromNodeId: string;
  toNodeId: string;
  relation: string;
  data?: JsonData;
};

export type KnowledgeLink = Required<KnowledgeLinkInput> & {
  projectId: string;
};

export type KnowledgeCitationInput = {
  fromNodeId: string;
  toNodeId: string;
  relation: string;
  texte: string;
  pieceId?: string | null;
  source?: string | null;
};

export type KnowledgeCitation = Required<KnowledgeCitationInput> & {
  id: number;
  projectId: string;
  createdAt: string;
};

export type KnowledgeMappingInput = {
  nodeId: string;
  real: string;
  masked: string;
  data?: JsonData;
};

export type KnowledgeMapping = Required<KnowledgeMappingInput> & {
  projectId: string;
};

export type KnowledgeSnapshot = {
  projectId: string;
  nodes: KnowledgeNode[];
  links: KnowledgeLink[];
  mappings: KnowledgeMapping[];
  citations: KnowledgeCitation[];
  exclusions?: string[];
  exclusionsInitialized?: boolean;
  anonymizationComplete?: boolean;
  reservedCodes?: string[];
};

export type KnowledgeResolvedLink = {
  relation: string;
  direction: 'outgoing' | 'incoming';
  data: JsonData;
  node: KnowledgeResolvedNode | null;
  cycle: boolean;
};

export type KnowledgeResolvedNode = KnowledgeNode & {
  mappings: KnowledgeMapping[];
  links: KnowledgeResolvedLink[];
};

export type KnowledgeQueryInput = {
  projectId?: string;
  projectPath?: string;
  kind?: NodeKind;
  query?: string;
  depth?: number;
  limit?: number;
};

export type KnowledgeQueryResult = {
  projectId: string;
  query: string;
  kind: NodeKind | null;
  depth: number;
  matches: KnowledgeResolvedNode[];
  ambiguous: boolean;
  truncated: boolean;
};

export type KnowledgeUpdateOperation =
  | { op: 'upsertNode'; node: KnowledgeNodeInput }
  | { op: 'link'; link: KnowledgeLinkInput }
  | { op: 'unlink'; link: Pick<KnowledgeLinkInput, 'fromNodeId' | 'toNodeId' | 'relation'> }
  | { op: 'upsertMapping'; mapping: KnowledgeMappingInput }
  | { op: 'cite'; citation: KnowledgeCitationInput }
  | { op: 'uncite'; id: number }
  | { op: 'deleteMapping'; mapping: Pick<KnowledgeMappingInput, 'nodeId' | 'real'> }
  | { op: 'removePartyDesignation'; nodeId: string }
  | { op: 'deleteNode'; nodeId: string }
  | { op: 'renameNode'; rename: { fromNodeId: string; toNodeId: string } }
  | { op: 'excludeTerm'; term: string }
  | { op: 'excludeLink'; exclusion: { piece: string; entite: string; relation: string } }
  | { op: 'excludeAlias'; exclusion: { entite: string; alias: string } };

export type KnowledgeUpdateInput = {
  projectId: string;
  operations: KnowledgeUpdateOperation[];
};

export type KnowledgeUpdateResult = {
  projectId: string;
  applied: number;
  nodes: number;
  links: number;
  mappings: number;
};

export type GlinerMappingDocument = {
  mapping?: Record<string, string>;
  reverse_mapping?: Record<string, string[] | string>;
  extracted_data?: Record<string, Record<string, JsonData>>;
  ignored?: string[];
};

export type GlinerDocument = {
  id: string;
  name: string;
  path?: string;
  metadata?: JsonData;
  entityCodes?: string[];
};

export type GlinerScanResult = {
  projectId: string;
  mapping: GlinerMappingDocument;
  documents: GlinerDocument[];
};
