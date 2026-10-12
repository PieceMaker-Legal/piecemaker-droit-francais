import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { KeyboardEvent } from 'react';

import { usePaletteOps } from '@/modules/command-palette';
import { useOpenWorkspacePanels } from '@/modules/piecemaker-workspace-tabs';
import { readWorkspaceContext, subscribeWorkspaceContext, syncPanels } from '@/modules/piecemaker-context-suggestions/contextStore';
import { publishWorkspaceContext } from '@/modules/piecemaker-context-suggestions/publishContext';
import { suggestQuestion } from '@/modules/piecemaker-context-suggestions/suggestion';

type ContextSuggestionOptions = {
  projectPath: string | null;
  input: string;
  placeholder: string;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
};

export function useContextSuggestion({ projectPath, input, placeholder, onKeyDown }: ContextSuggestionOptions) {
  const panels = useOpenWorkspacePanels();
  const context = useSyncExternalStore(subscribeWorkspaceContext, readWorkspaceContext);
  const { insertComposerText } = usePaletteOps();

  useEffect(() => syncPanels(projectPath, panels ?? []), [projectPath, panels]);
  useEffect(() => publishWorkspaceContext(context), [context]);

  const question = input ? null : suggestQuestion(context);
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (question && event.key === 'Tab' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      insertComposerText(question);
      return;
    }
    onKeyDown(event);
  }, [question, insertComposerText, onKeyDown]);

  return {
    placeholder: question ? `${question.trim()} (⇥)` : placeholder,
    onKeyDown: handleKeyDown,
  };
}
