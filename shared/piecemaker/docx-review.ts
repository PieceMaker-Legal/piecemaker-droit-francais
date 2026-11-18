export type DocxEdit = {
  find: string;
  replace: string;
  context_before: string;
  context_after: string;
  reason?: string;
};

export type DocxEditAnnotation = {
  edit_id: string;
  version_id: string;
  change_id: string;
  del_w_id?: string;
  ins_w_id?: string;
  deleted_text: string;
  inserted_text: string;
  context_before: string;
  context_after: string;
  reason?: string;
  status: 'pending' | 'accepted' | 'rejected';
};

export type DocxReview = {
  sha256: string;
  current_version_id: string | null;
  versions: { id: string; version_number: number; created_at: string; source: 'upload' | 'assistant_edit' }[];
  annotations: DocxEditAnnotation[];
};
