import { useEffect } from 'react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';

import { useOptionalProjectMainState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { useProcessingSessions } from '@/shared/context/SessionProtectionContext';
import type { QueuedDraft } from '@/shared/types';

const DOCX_COMMENT_QUESTION_EVENT = 'piecemaker:docx-comment-question';

type DocxCommentQuestionDetail = {
  projectId: string;
  sessionId: string | null;
  prompt: string;
  accepted: boolean;
};

type UseDocxCommentQuestionsOptions = {
  sessionId: string | null | undefined;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  queuedDraft: QueuedDraft | null;
  handleSubmit: (event: FormEvent<HTMLFormElement>, queuedSubmission?: QueuedDraft) => Promise<void>;
};

export function askOpenChat(projectId: string, sessionId: string | null, prompt: string): boolean {
  const detail: DocxCommentQuestionDetail = { projectId, sessionId, prompt, accepted: false };
  window.dispatchEvent(new CustomEvent(DOCX_COMMENT_QUESTION_EVENT, { detail }));
  return detail.accepted;
}

export function useDocxCommentQuestions({ sessionId, input, setInput, queuedDraft, handleSubmit }: UseDocxCommentQuestionsOptions) {
  const projectId = useOptionalProjectMainState()?.selectedProject?.projectId ?? null;
  const backgroundWork = useProcessingSessions().get(sessionId ?? '')?.background ?? false;

  useEffect(() => {
    if (!projectId) return undefined;
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<DocxCommentQuestionDetail>).detail;
      if (detail.projectId !== projectId || detail.sessionId !== (sessionId ?? null)) return;
      if (detail.accepted || queuedDraft || backgroundWork) return;
      detail.accepted = true;
      const submit = { preventDefault: () => undefined } as FormEvent<HTMLFormElement>;
      void handleSubmit(submit, { content: detail.prompt, attachments: [] }).then(() => {
        if (input) setInput(input);
      });
    };
    window.addEventListener(DOCX_COMMENT_QUESTION_EVENT, receive);
    return () => window.removeEventListener(DOCX_COMMENT_QUESTION_EVENT, receive);
  }, [backgroundWork, handleSubmit, input, projectId, queuedDraft, sessionId, setInput]);
}
