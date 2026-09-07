export type MikeWorkflowType = 'assistant' | 'tabular';

export type MikeColumnFormat =
  | 'text'
  | 'bulleted_list'
  | 'number'
  | 'currency'
  | 'yes_no'
  | 'date'
  | 'tag'
  | 'percentage'
  | 'monetary_amount';

export type MikeColumnConfig = {
  index: number;
  name: string;
  prompt: string;
  format?: MikeColumnFormat;
  tags?: string[];
};

export type MikeWorkflow = {
  id: string;
  metadata: {
    title: string;
    description: string | null;
    type: MikeWorkflowType;
    practice: string | null;
    language: string;
    jurisdictions: string[] | null;
  };
  skill_md: string | null;
  columns_config: MikeColumnConfig[] | null;
  is_default?: boolean;
  created_at: string;
};

export type MikeLibraryDocumentStatus = 'pending' | 'processing' | 'ready' | 'error';

export type MikeLibraryDocument = {
  id: string;
  filename: string;
  file_type: string | null;
  size_bytes: number | null;
  status: MikeLibraryDocumentStatus;
  created_at: string | null;
  folder_id: string | null;
};

export type MikeLibraryFolder = {
  id: string;
  name: string;
  parent_folder_id: string | null;
};

export type MikeTabularReview = {
  id: string;
  title: string | null;
  columns_config: MikeColumnConfig[] | null;
  document_count?: number;
  updated_at: string;
  created_at: string;
  is_running?: boolean;
};

export type MikeTabularCellFlag = 'green' | 'grey' | 'yellow' | 'red';

export type MikeTabularCellStatus = 'pending' | 'generating' | 'done' | 'error';

export type MikeTabularCell = {
  id: string;
  row_id: string;
  column_index: number;
  content: {
    summary: string;
    flag?: MikeTabularCellFlag;
    reasoning?: string;
  } | null;
  status: MikeTabularCellStatus;
};

export type MikeTabularRow = {
  id: string;
  label: string;
  sort_index: number;
};

export type MikeTabularReviewDetail = {
  review: MikeTabularReview;
  cells: MikeTabularCell[];
  rows: MikeTabularRow[];
  documents: unknown[];
};
