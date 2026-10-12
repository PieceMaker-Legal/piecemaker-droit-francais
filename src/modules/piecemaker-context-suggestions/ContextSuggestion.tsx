import { SparklesIcon } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';

import { usePaletteOps } from '@/modules/command-palette';
import { useOpenWorkspacePanels } from '@/modules/piecemaker-workspace-tabs';
import { readWorkspaceContext, subscribeWorkspaceContext, syncPanels } from '@/modules/piecemaker-context-suggestions/contextStore';
import { publishWorkspaceContext } from '@/modules/piecemaker-context-suggestions/publishContext';
import { suggestQuestions } from '@/modules/piecemaker-context-suggestions/suggestion';

type ContextSuggestionProps = { projectPath: string | null; hidden: boolean };

export function ContextSuggestion({ projectPath, hidden }: ContextSuggestionProps) {
  const panels = useOpenWorkspacePanels();
  const context = useSyncExternalStore(subscribeWorkspaceContext, readWorkspaceContext);
  const { insertComposerText } = usePaletteOps();

  useEffect(() => syncPanels(projectPath, panels ?? []), [projectPath, panels]);
  useEffect(() => publishWorkspaceContext(context), [context]);

  const questions = suggestQuestions(context);
  if (hidden || !questions.length) return null;
  return (
    <div className="mx-auto mb-2 flex w-full max-w-4xl flex-wrap gap-1.5 px-2 sm:px-4">
      {questions.map((question) => <button
        key={question}
        type="button"
        onClick={() => insertComposerText(question)}
        className="flex min-w-0 max-w-full items-center gap-1.5 rounded-2xl border border-border/60 bg-card px-3 py-1 text-left text-xs text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
      >
        <SparklesIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="whitespace-normal break-words">{question.trim()}</span>
      </button>)}
    </div>
  );
}
