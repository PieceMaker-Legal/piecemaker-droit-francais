import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { TFunction } from 'i18next';

import { agentApi } from '@/modules/piecemaker-workspace-tabs';
import type { LLMProvider, Project, SessionWithProvider } from '@/shared/types';

type SidebarAgentButtonProps = {
  project: Project;
  sessions: SessionWithProvider[];
  onSessionSelect: (session: SessionWithProvider, projectId: string) => void;
  t: TFunction;
};

export default function SidebarAgentButton({ project, sessions, onSessionSelect, t }: SidebarAgentButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const open = async () => {
    setOpening(true);
    setError(null);
    try {
      const { sessionId, provider } = await agentApi.openSession(project.fullPath);
      const session = sessions.find((item) => item.id === sessionId)
        ?? { id: sessionId, __provider: (provider ?? 'claude') as LLMProvider, __projectId: project.projectId, summary: t('sessions.piecemakerAgent') };
      onSessionSelect(session, project.projectId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOpening(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="flex h-8 w-full items-center gap-2 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
        title={t('sessions.piecemakerAgentTitle')}
        disabled={opening}
        onClick={() => void open()}
      >
        <Sparkles className="h-3 w-3" />
        {t('sessions.piecemakerAgent')}
      </button>
      {error && <p className="px-1 pt-1 text-xs text-destructive">{error}</p>}
    </>
  );
}
