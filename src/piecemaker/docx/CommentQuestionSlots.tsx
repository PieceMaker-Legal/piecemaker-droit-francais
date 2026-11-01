import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';

import type { CommentQuestion } from '@/piecemaker/docx/commentQuestions';

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
      if (records.every((record) => (record.target as Element).closest?.('.docx-comment-ask, .docx-comment-pending'))) return;
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
  const form = container.querySelector('.docx-unified-sidebar textarea')?.parentElement;
  return (
    <>
      {form && providerLabel && createPortal(
        <label className="docx-comment-ask" onMouseDown={(event) => event.preventDefault()}>
          <input type="checkbox" checked={askEnabled} onChange={(event) => onAskEnabledChange(event.target.checked)} />
          Envoyer à {providerLabel}
        </label>,
        form,
      )}
      {questions.map((question) => {
        const card = container.querySelector(`.docx-comment-card[data-comment-id="${question.commentId}"]`);
        if (!card) return null;
        return createPortal(
          <div key={question.token} className="docx-comment-pending" role="status" onClick={(event) => event.stopPropagation()}>
            <strong>{question.providerLabel} répond…</strong>
            {partialAnswers[question.token] && <p>{partialAnswers[question.token]}</p>}
          </div>,
          card,
          question.token,
        );
      })}
    </>
  );
}
