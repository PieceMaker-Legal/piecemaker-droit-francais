import { readDraftText, writeDraftText } from '@/shared/chatDrafts';

export const LEGAL_CODE_COMMAND = '/legal-code ';

const projectScope = (projectId: string) => `project:${projectId}`;

export function prefillLegalCode(projectId: string): void {
  writeDraftText(projectScope(projectId), LEGAL_CODE_COMMAND);
}

export function isLegalCodeDraft(projectId: string): boolean {
  return readDraftText(projectScope(projectId)).trimStart().startsWith(LEGAL_CODE_COMMAND.trim());
}
