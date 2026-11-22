import { useState } from 'react';
import type { TFunction } from 'i18next';

import { agentApi } from '@/modules/piecemaker-workspace-tabs';
import type { SessionWithProvider } from '@/shared/types';

type SidebarCentralAgentButtonProps = {
  onSessionSelect: (session: SessionWithProvider, projectId: string) => void;
  t: TFunction;
};

/** Rendered by SidebarProjectList above every folder: opens the central agent, which coordinates threads across the folders the user chose. */
export default function SidebarCentralAgentButton({ onSessionSelect, t }: SidebarCentralAgentButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const open = async () => {
    setOpening(true);
    setError(null);
    try {
      const { sessionId, provider, projectId } = await agentApi.openCentral();
      onSessionSelect({ id: sessionId, summary: t('sessions.centralAgent'), __projectId: projectId ?? undefined, __provider: provider ?? 'claude' }, projectId ?? '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="px-3 pb-2 pt-1 md:px-0">
      <button
        type="button"
        className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
        title={t('sessions.centralAgentTitle')}
        disabled={opening}
        onClick={() => void open()}
      >
        <span aria-hidden="true" className="h-4 w-4 shrink-0 bg-primary" style={{ mask: "url(/logo-32.png) center / contain no-repeat" }} />
        {t('sessions.centralAgent')}
      </button>
      {error && <p className="px-1 pt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
