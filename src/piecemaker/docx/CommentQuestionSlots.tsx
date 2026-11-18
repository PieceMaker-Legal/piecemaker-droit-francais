import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';

import type { CommentQuestion } from '@/piecemaker/docx/commentQuestions';
import { aiAvatarHosts } from '@/piecemaker/docx/CommentAuthorLogo';
import { CommentMarkdown, commentTextHosts } from '@/piecemaker/docx/CommentMarkdown';
import { LLMProviderLogo } from '@/shared/ui/LLMProviderLogo';

type CommentQuestionSlotsProps = {
  containerRef: RefObject<HTMLDivElement>;
  providerLabel: string | null;
  askEnabled: boolean;
  onAskEnabledChange: (enabled: boolean) => void;
  questions: CommentQuestion[];
  partialAnswers: Record<string, string>;
};

function useNodeTick(containerRef: RefObject<HTMLDivElement>) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const observer = new MutationObserver((records) => {
      if (records.every((record) => (record.target as Element).closest?.('.docx-comment-ask, .docx-comment-pending, .docx-comment-markdown, .docx-comment-avatar-ai'))) return;
      setTick((tick) => tick + 1);
    });
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [containerRef]);
}

export function CommentQuestionSlots({ containerRef, providerLabel, askEnabled, onAskEnabledChange, questions, partialAnswers }: CommentQuestionSlotsProps) {
  useNodeTick(containerRef);
  const container = containerRef.current;
  if (!container) return null;
  const forms = [
    container.querySelector('.docx-unified-sidebar textarea')?.parentElement,
    container.querySelector('.docx-unified-sidebar .docx-comment-card input:not([readonly])')?.parentElement,
  ];
  return (
    <>
      {aiAvatarHosts(container).map(({ provider, host }, index) => createPortal(<LLMProviderLogo provider={provider} className="docx-comment-avatar-logo" />, host, `avatar-${index}`))}
      {commentTextHosts(container).map(({ text, host }, index) => createPortal(<CommentMarkdown>{text}</CommentMarkdown>, host, `markdown-${index}`))}
      {providerLabel && forms.map((form, index) => form && createPortal(
        <label className="docx-comment-ask" onMouseDown={(event) => event.preventDefault()}>
          <input type="checkbox" checked={askEnabled} onChange={(event) => onAskEnabledChange(event.target.checked)} />
          Envoyer à {providerLabel}
        </label>,
        form,
        `ask-${index}`,
      ))}
      {questions.map((question) => {
        const card = container.querySelector(`.docx-comment-card[data-comment-id="${question.commentId}"]`);
        if (!card) return null;
        return createPortal(
          <div key={question.token} className="docx-comment-pending" role="status" onClick={(event) => event.stopPropagation()}>
            <strong>{question.providerLabel} répond…</strong>
            {partialAnswers[question.token] && <div className="docx-comment-pending-answer"><CommentMarkdown>{partialAnswers[question.token]}</CommentMarkdown></div>}
          </div>,
          card,
          question.token,
        );
      })}
    </>
  );
}
