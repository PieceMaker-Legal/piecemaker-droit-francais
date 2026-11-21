import { useState } from 'react';
import type { TFunction } from 'i18next';

import { agentApi } from '@/modules/piecemaker-workspace-tabs';
import type { Project, SessionWithProvider } from '@/shared/types';

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
      const existing = sessions.find(item => item.id === sessionId);
      onSessionSelect({
        ...(existing ?? { id: sessionId, summary: t('sessions.piecemakerAgent') }),
        __projectId: project.projectId,
        __provider: provider ?? existing?.__provider ?? 'claude',
      }, project.projectId);
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
        className="flex h-8 w-full items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        title={t('sessions.piecemakerAgentTitle')}
        disabled={opening}
        onClick={() => void open()}
      >
        <span aria-hidden="true" className="h-3 w-3 shrink-0 bg-current" style={{ mask: "url(/logo-32.png) center / contain no-repeat" }} />
        {t('sessions.piecemakerAgent')}
      </button>
      {error && <p className="px-1 pt-1 text-xs text-destructive">{error}</p>}
    </>
  );
}
