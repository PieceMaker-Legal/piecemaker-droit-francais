import { authenticatedFetch } from '@/shared/api';

export async function checkDocxDocumentReasoning(projectId: string, filePath: string) {
  const query = new URLSearchParams({ projectId, path: filePath });
  const response = await authenticatedFetch(`/api/piecemaker/docx-document/reasoning?${query}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<{ version: number; reasoning: unknown }>;
}

export type DocxReasoningReport =
  | { status: 'unlinked' }
  | { status: 'tested'; issues: { kind: string; text: string }[]; objectives?: { objectif?: string; montant_calcule?: number }[] }
  | { status: 'review'; changed: string[]; context: { tag: string; text: string }[] }
  | { status: 'error'; message: string };
export type DocxReasoningCheckState = { phase: 'idle' | 'dirty' | 'checking' | 'ready'; report: DocxReasoningReport | null };
