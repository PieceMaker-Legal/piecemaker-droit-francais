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
};

export type Cell = {
  summary: string;
  flag: Flag;
  reasoning: string;
};

export type Provider = 'claude' | 'codex';

export type ReviewStatus = 'running' | 'done' | 'partial' | 'cancelled' | 'interrupted';

export type Review = {
  version: 1;
  title: string;
  templateName: string;
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

export const OPEN_EVENT = 'piecemaker:tabular-review-open';
export const PENDING_TARGET_KEY = '__piecemakerTabularReviewTarget';
