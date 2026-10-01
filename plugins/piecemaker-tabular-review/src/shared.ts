export type Flag = 'green' | 'yellow' | 'red' | 'grey';

export type ColumnFormat = 'text' | 'list' | 'date' | 'amount' | 'yes_no' | 'tags';

export type TemplateColumn = {
  name: string;
  prompt: string;
  format: ColumnFormat;
  tags?: string[];
};

export type Template = {
  id: string;
  name: string;
  description: string;
  columns: TemplateColumn[];
  updatedAt: string;
};

export type ReviewColumn = TemplateColumn & { index: number };

export type ReviewDocument = {
  source: string;
  copy: string;
  chars: number;
};

export type RowStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled';

export type ReviewRow = {
  id: string;
  label: string;
  documents: ReviewDocument[];
  status: RowStatus;
  mode?: 'inline' | 'path';
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  corrections?: number;
};

export type TextRange = { start: number; end: number };

export type CellCitation = {
  document: string;
  quote: string;
  verified: boolean;
  ranges?: TextRange[];
};

export type Cell = {
  summary: string;
  flag: Flag;
  reasoning: string;
  citations?: CellCitation[];
};

export type CitationSource = {
  document: string;
  link: string | null;
  quote: string;
  verified: boolean;
  text: string;
  offset: number;
  length: number;
  ranges: TextRange[];
};

export const MAX_CITATION_CORRECTIONS = 3;

export type Provider = 'claude' | 'codex' | 'mistral';

export type ReviewStatus = 'running' | 'done' | 'partial' | 'cancelled' | 'interrupted';

export type ReviewCategory = 'documents' | 'recherche-juridique';

export const CATEGORY_LABELS: Record<ReviewCategory, string> = {
  documents: 'Analyse de documents',
  'recherche-juridique': 'Recherche juridique',
};

export function reviewCategory(review: { category?: unknown }): ReviewCategory {
  return review.category === 'recherche-juridique' ? 'recherche-juridique' : 'documents';
}

export type ReviewResearch = {
  query: string;
  criteria: string[];
  dispositifOnly: boolean;
  total: number;
};

export type Review = {
  version: 1;
  title: string;
  templateName: string;
  category?: ReviewCategory;
  research?: ReviewResearch;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
  provider: Provider;
  model: string;
  concurrency: number;
  columns: ReviewColumn[];
  rows: ReviewRow[];
  cells: Record<string, Record<string, Cell>>;
};

export type ReviewSummary = {
  project: string;
  file: string;
  title: string;
  templateName: string;
  category: ReviewCategory;
  query?: string;
  createdAt: string;
  status: ReviewStatus;
  rowCount: number;
  doneCount: number;
  columnCount: number;
  provider: Provider;
  model: string;
};

export type ReviewDetail = {
  project: string;
  file: string;
  status: ReviewStatus;
  review: Review;
};

export type MarkdownDocument = {
  path: string;
  size: number;
  modifiedAt: string;
};

export type RowRequest = {
  label: string;
  documents: string[];
};

export type CreateReviewRequest = {
  project: string;
  templateId: string;
  title: string;
  rows: RowRequest[];
  provider: Provider;
  model: string;
  concurrency: number;
  proxyOrigin: string;
};

export type ExportFormat = 'docx' | 'pdf';

export type ExportResult = {
  path: string;
  filename: string;
  base64: string;
};

export const FLAGS: Flag[] = ['green', 'yellow', 'red', 'grey'];

export const FLAG_LABELS: Record<Flag, string> = {
  green: 'Standard ou favorable',
  yellow: 'À surveiller',
  red: 'Problématique ou défavorable',
  grey: 'Neutre ou non trouvé',
};

export const FLAG_COLORS: Record<Flag, string> = {
  green: '#16a34a',
  yellow: '#ca8a04',
  red: '#dc2626',
  grey: '#9ca3af',
};

export const COLUMN_FORMATS: { value: ColumnFormat; label: string }[] = [
  { value: 'text', label: 'Texte' },
  { value: 'list', label: 'Liste' },
  { value: 'date', label: 'Date' },
  { value: 'amount', label: 'Montant' },
  { value: 'yes_no', label: 'Oui / Non' },
  { value: 'tags', label: 'Étiquettes' },
];

export const REVIEW_FOLDER = 'Tabular Review';
export const DOCS_FOLDER = 'docs';

export function reviewStatusLabel(status: ReviewStatus): string {
  return {
    running: 'En cours',
    done: 'Terminée',
    partial: 'Terminée avec erreurs',
    cancelled: 'Annulée',
    interrupted: 'Interrompue',
  }[status];
}

export const EMPTY_CELL_SUMMARY = 'Non traité';
export const NOT_FOUND_SUMMARY = 'Non trouvé';

export function citationRequired(cell: Cell): boolean {
  const summary = cell.summary.trim();
  return summary !== EMPTY_CELL_SUMMARY && summary.replace(/[.\s]+$/, '').toLowerCase() !== NOT_FOUND_SUMMARY.toLowerCase();
}

export function citationIssue(cell: Cell): 'missing' | 'unverified' | null {
  if (!citationRequired(cell)) return null;
  if (!cell.citations?.length) return 'missing';
  return cell.citations.some((citation) => !citation.verified) ? 'unverified' : null;
}

export function isCellFilled(cell: Cell | undefined): cell is Cell {
  return Boolean(cell) && cell!.summary.trim() !== '' && cell!.summary !== EMPTY_CELL_SUMMARY;
}

export function emptyColumns(review: Review, rowId: string, columns?: number[]): number[] {
  const wanted = columns ?? review.columns.map((column) => column.index);
  return wanted.filter((index) => review.columns.some((column) => column.index === index) && !isCellFilled(review.cells[rowId]?.[String(index)]));
}

export type RunRequest = {
  project: string;
  file: string;
  rowId?: string;
  column?: number;
  replace?: boolean;
  proxyOrigin: string;
};

export const OPEN_EVENT = 'piecemaker:tabular-review-open';
export const PENDING_TARGET_KEY = '__piecemakerTabularReviewTarget';

export type ResearchSource = 'cassation' | 'appel' | 'conseil_etat' | 'caa' | 'premiere_instance';

export type BulletinPublication = 'TOUS' | 'PUBLIE' | 'INEDIT';

export type LebonPublication = 'TOUS' | 'PUBLIE' | 'NON_PUBLIE';

export type ResearchFilters = {
  query: string;
  sources: ResearchSource[];
  matieres: string[];
  publicationBulletin: BulletinPublication;
  sieges: string[];
  publicationConseilEtat: LebonPublication;
  villesCaa: string[];
  publicationCaa: LebonPublication;
  typesPremiereInstance: string[];
  dateDebut: string;
  dateFin: string;
  dispositifOnly: boolean;
};

export type Option = { value: string; label: string };

export const RESEARCH_SOURCES: { value: ResearchSource; label: string }[] = [
  { value: 'cassation', label: 'Cour de cassation' },
  { value: 'appel', label: 'Cours d’appel' },
  { value: 'conseil_etat', label: 'Conseil d’État' },
  { value: 'caa', label: 'Cours administratives d’appel' },
  { value: 'premiere_instance', label: 'Première instance' },
];

export const CASSATION_MATIERES: Option[] = [
  { value: 'CIVIL', label: 'Civil' },
  { value: 'COMMERCIAL', label: 'Commercial' },
  { value: 'PENAL', label: 'Pénal (chambre criminelle)' },
  { value: 'SOCIAL', label: 'Social' },
];

export const BULLETIN_PUBLICATIONS: { value: BulletinPublication; label: string }[] = [
  { value: 'TOUS', label: 'Toutes' },
  { value: 'PUBLIE', label: 'Publiées au Bulletin' },
  { value: 'INEDIT', label: 'Inédites' },
];

export const LEBON_PUBLICATIONS: { value: LebonPublication; label: string }[] = [
  { value: 'TOUS', label: 'Toutes' },
  { value: 'PUBLIE', label: 'Publiées au recueil Lebon' },
  { value: 'NON_PUBLIE', label: 'Non publiées' },
];

export const APPEL_SIEGES: Option[] = [
  ['AGEN', 'Agen'], ['AIX-PROVENCE', 'Aix-en-Provence'], ['AMIENS', 'Amiens'], ['ANGERS', 'Angers'], ['BASSE-TERRE', 'Basse-Terre'],
  ['BASTIA', 'Bastia'], ['BESANCON', 'Besançon'], ['BORDEAUX', 'Bordeaux'], ['BOURGES', 'Bourges'], ['CAEN', 'Caen'],
  ['CAYENNE', 'Cayenne'], ['CHAMBERY', 'Chambéry'], ['COLMAR', 'Colmar'], ['DIJON', 'Dijon'], ['DOUAI', 'Douai'],
  ['FORT-DE-FRANCE', 'Fort-de-France'], ['GRENOBLE', 'Grenoble'], ['LIMOGES', 'Limoges'], ['LYON', 'Lyon'], ['METZ', 'Metz'],
  ['MONTPELLIER', 'Montpellier'], ['NANCY', 'Nancy'], ['NIMES', 'Nîmes'], ['NOUMEA', 'Nouméa'], ['ORLEANS', 'Orléans'],
  ['PAPEETE', 'Papeete'], ['PARIS', 'Paris'], ['PAU', 'Pau'], ['POITIERS', 'Poitiers'], ['REIMS', 'Reims'],
  ['RENNES', 'Rennes'], ['RIOM', 'Riom'], ['ROUEN', 'Rouen'], ['ST-DENIS-REUNION', 'Saint-Denis de La Réunion'], ['TOULOUSE', 'Toulouse'],
  ['VERSAILLES', 'Versailles'],
].map(([value, label]) => ({ value, label }));

export const CAA_VILLES: Option[] = [
  ['BORDEAUX', 'Bordeaux'], ['DOUAI', 'Douai'], ['LYON', 'Lyon'], ['MARSEILLE', 'Marseille'], ['NANCY', 'Nancy'],
  ['NANTES', 'Nantes'], ['PARIS', 'Paris'], ['TOULOUSE', 'Toulouse'], ['VERSAILLES', 'Versailles'],
].map(([value, label]) => ({ value, label }));

export const PREMIERE_INSTANCE_TYPES: Option[] = [
  ['TRIBUNAL_JUDICIAIRE', 'Tribunal judiciaire'],
  ['TRIBUNAL_GRANDE_INSTANCE', 'Tribunal de grande instance'],
  ['TRIBUNAL_INSTANCE', 'Tribunal d’instance'],
  ['TRIBUNAL_COMMERCE', 'Tribunal de commerce'],
  ['CONSEIL_PRUDHOMMES', 'Conseil de prud’hommes'],
  ['TRIBUNAL_CORRECTIONNEL', 'Tribunal correctionnel'],
  ['TRIBUNAL_SECURITE_SOCIALE', 'Tribunal des affaires de sécurité sociale'],
  ['TRIBUNAL_BAUX_RURAUX', 'Tribunal paritaire des baux ruraux'],
  ['JURIDICTION_PROXIMITE', 'Juridiction de proximité'],
  ['OUTRE_MER', 'Juridictions d’outre-mer'],
  ['TRIBUNAL_CONFLITS', 'Tribunal des conflits'],
].map(([value, label]) => ({ value, label }));

export const RESEARCH_LIMIT = 500;
export const RESEARCH_PAGE_SIZE = 10;

export type ResearchPhase = 'counting' | 'listing' | 'downloading' | 'done' | 'too_broad' | 'error' | 'cancelled';

export type ResearchCount = { source: ResearchSource; total: number; legifrance?: number; judilibre?: number };

export type ResearchOrigin = 'legifrance' | 'judilibre';

export type ZoneOrigin = 'judilibre' | 'formules';

export type ResearchState = {
  id: string;
  phase: ResearchPhase;
  filters: ResearchFilters;
  counts: ResearchCount[];
  total: number;
  listed: number;
  downloaded: number;
  kept: number;
  excluded: number;
  undetected: number;
  failed: number;
  unmatched?: number;
  error?: string;
  warnings?: string[];
  createdAt: string;
};

export type ResearchZone = 'motifs' | 'dispositif' | 'absente' | 'integral';

export type ResearchDecision = {
  id: string;
  rank: number;
  kept: boolean;
  title: string;
  source: ResearchSource;
  date: string;
  importance: string;
  titrage: string;
  analysis: string;
  analysisKind: 'analyse' | 'extrait' | 'aucune';
  zone: ResearchZone;
  zoneOrigin?: ZoneOrigin;
  origin?: ResearchOrigin;
  link: string;
  chars: number;
  error?: string;
};

export type ResearchView = 'kept' | 'excluded';

export type ResearchPage = {
  state: ResearchState;
  view: ResearchView;
  page: number;
  pageCount: number;
  count: number;
  items: ResearchDecision[];
};

export type ResearchText = {
  id: string;
  zone: ResearchZone;
  zoneOrigin?: ZoneOrigin;
  retained: string;
  full: string;
};

export const ZONE_LABELS: Record<ResearchZone, string> = {
  motifs: 'Motifs et dispositif',
  dispositif: 'Dispositif seul (motifs non repérés)',
  absente: 'Partie du juge non repérée : texte intégral conservé',
  integral: 'Texte intégral',
};

export const ZONE_ORIGIN_LABELS: Record<ZoneOrigin, string> = {
  judilibre: 'découpage officiel Judilibre',
  formules: 'repérage par formules',
};

export const ORIGIN_LABELS: Record<ResearchOrigin, string> = {
  legifrance: 'Légifrance',
  judilibre: 'Judilibre',
};

export function researchCriteria(filters: ResearchFilters): string[] {
  const label = (options: Option[], values: string[]) => values.map((value) => options.find((option) => option.value === value)?.label ?? value).join(', ');
  const lower = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);
  const criteria: string[] = [];
  for (const source of filters.sources) {
    const name = RESEARCH_SOURCES.find((entry) => entry.value === source)?.label ?? source;
    const details: string[] = [];
    if (source === 'cassation') {
      details.push(label(CASSATION_MATIERES, filters.matieres));
      if (filters.publicationBulletin !== 'TOUS') details.push(lower(BULLETIN_PUBLICATIONS.find((entry) => entry.value === filters.publicationBulletin)!.label));
    }
    if (source === 'appel' && filters.sieges.length) details.push(label(APPEL_SIEGES, filters.sieges));
    if (source === 'conseil_etat' && filters.publicationConseilEtat !== 'TOUS') details.push(lower(LEBON_PUBLICATIONS.find((entry) => entry.value === filters.publicationConseilEtat)!.label));
    if (source === 'caa') {
      if (filters.villesCaa.length) details.push(label(CAA_VILLES, filters.villesCaa));
      if (filters.publicationCaa !== 'TOUS') details.push(lower(LEBON_PUBLICATIONS.find((entry) => entry.value === filters.publicationCaa)!.label));
    }
    if (source === 'premiere_instance') details.push(label(PREMIERE_INSTANCE_TYPES, filters.typesPremiereInstance));
    criteria.push(details.filter(Boolean).length ? `${name} (${details.filter(Boolean).join(' ; ')})` : name);
  }
  if (filters.dateDebut || filters.dateFin) criteria.push(`Période : ${filters.dateDebut || '…'} → ${filters.dateFin || '…'}`);
  if (filters.dispositifOnly) criteria.push('Recherche dans le dispositif uniquement');
  return criteria;
}
