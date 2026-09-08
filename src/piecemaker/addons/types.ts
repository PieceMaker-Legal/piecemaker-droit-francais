export type AddonsWorkflowType = 'assistant' | 'tabular';

export type AddonsColumnFormat =
  | 'text'
  | 'bulleted_list'
  | 'number'
  | 'currency'
  | 'yes_no'
  | 'date'
  | 'tag'
  | 'percentage'
  | 'monetary_amount';

export type AddonsColumnConfig = {
  index: number;
  name: string;
  prompt: string;
  format?: AddonsColumnFormat;
  tags?: string[];
};

export type AddonsWorkflow = {
  id: string;
  metadata: {
    title: string;
    description: string | null;
    type: AddonsWorkflowType;
    practice: string | null;
    language: string;
    jurisdictions: string[] | null;
  };
  skill_md: string | null;
  columns_config: AddonsColumnConfig[] | null;
  is_default?: boolean;
  created_at: string;
};

export type AddonsLibraryDocumentStatus = 'pending' | 'processing' | 'ready' | 'error';

export type AddonsLibraryDocument = {
  id: string;
  filename: string;
  file_type: string | null;
  size_bytes: number | null;
  status: AddonsLibraryDocumentStatus;
  created_at: string | null;
  folder_id: string | null;
};

export type AddonsLibraryFolder = {
  id: string;
  name: string;
  parent_folder_id: string | null;
};

export type AddonsTabularReview = {
  id: string;
  title: string | null;
  columns_config: AddonsColumnConfig[] | null;
  document_count?: number;
  updated_at: string;
  created_at: string;
  is_running?: boolean;
};

export type AddonsTabularCellFlag = 'green' | 'grey' | 'yellow' | 'red';

export type AddonsTabularCellStatus = 'pending' | 'generating' | 'done' | 'error';

export type AddonsTabularCell = {
  id: string;
  row_id: string;
  column_index: number;
  content: {
    summary: string;
    flag?: AddonsTabularCellFlag;
    reasoning?: string;
  } | null;
  status: AddonsTabularCellStatus;
};

export type AddonsTabularRow = {
  id: string;
  label: string;
  sort_index: number;
};

export type AddonsTabularReviewDetail = {
  review: AddonsTabularReview;
  cells: AddonsTabularCell[];
  rows: AddonsTabularRow[];
  documents: unknown[];
};

export type AddonAsset = {
  id: string;
  filename: string;
  file_type: string | null;
  size_bytes: number | null;
  created_at: string | null;
};

export type AddonContributor = {
  name: string;
  organisation: string | null;
  role: string | null;
  linkedin: string | null;
};

export type WorkflowAddon = {
  id: string;
  addon_key: string;
  pack_key: string;
  pack_title: string;
  pack_description: string | null;
  pack_version: string | null;
  version: string | null;
  title: string;
  description: string | null;
  type: AddonsWorkflowType;
  contributors: AddonContributor[] | null;
  language: string | null;
  practice: string | null;
  jurisdictions: string[] | null;
  active: boolean;
  updated_at: string | null;
  assets: AddonAsset[];
};

export type WorkflowAddonDetail = WorkflowAddon & {
  prompt_md: string | null;
  columns_config: AddonsColumnConfig[] | null;
};
