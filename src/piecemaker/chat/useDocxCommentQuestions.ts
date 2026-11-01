import { useEffect } from 'react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';

import type { QueuedDraft } from '@/shared/types';

const DOCX_COMMENT_QUESTION_EVENT = 'piecemaker:docx-comment-question';

type DocxCommentQuestionDetail = {
  sessionId: string;
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

export function askOpenChat(sessionId: string, prompt: string): boolean {
  const detail: DocxCommentQuestionDetail = { sessionId, prompt, accepted: false };
  window.dispatchEvent(new CustomEvent(DOCX_COMMENT_QUESTION_EVENT, { detail }));
  return detail.accepted;
}

export function useDocxCommentQuestions({ sessionId, input, setInput, queuedDraft, handleSubmit }: UseDocxCommentQuestionsOptions) {
  useEffect(() => {
    if (!sessionId) return undefined;
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<DocxCommentQuestionDetail>).detail;
      if (detail.sessionId !== sessionId || detail.accepted || queuedDraft) return;
      detail.accepted = true;
      const submit = { preventDefault: () => undefined } as FormEvent<HTMLFormElement>;
      void handleSubmit(submit, { content: detail.prompt, attachments: [] }).then(() => {
        if (input) setInput(input);
      });
    };
    window.addEventListener(DOCX_COMMENT_QUESTION_EVENT, receive);
    return () => window.removeEventListener(DOCX_COMMENT_QUESTION_EVENT, receive);
  }, [handleSubmit, input, queuedDraft, sessionId, setInput]);
}
