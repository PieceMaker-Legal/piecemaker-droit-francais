import { FileText } from 'lucide-react';
import { useCallback, useEffect } from 'react';

import { openArtifactInPanel } from '@/modules/piecemaker-artifacts/openArtifactInPanel';
import { useArtifactResource } from '@/modules/piecemaker-artifacts/hooks/useArtifactResource';
import { artifactsApi } from '@/shared/api';
import type { ServerEvent } from '@/shared/types';
import { Button } from '@/shared/ui';

type SessionArtifactsProps = {
  project: string;
  sessionId: string;
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
};

export function SessionArtifacts({ project, sessionId, subscribe }: SessionArtifactsProps) {
  const load = useCallback(() => artifactsApi.forSession(project, sessionId), [project, sessionId]);
  const { value, refresh } = useArtifactResource(load);

  useEffect(() => subscribe((event) => {
    if (event.kind === 'websocket_reconnected' || (event.kind === 'complete' && event.sessionId === sessionId)) void refresh();
  }), [refresh, sessionId, subscribe]);

  if (!value?.length) return null;

  return (
    <div role="group" aria-label="Artifacts de la session" className="scrollbar-hide flex min-w-0 shrink-0 gap-2 overflow-x-auto border-b px-3 py-2">
      {value.map(({ id, title }) => (
        <Button key={id} type="button" size="sm" variant="outline" className="shrink-0" onClick={() => openArtifactInPanel(project, id)}>
          <FileText aria-hidden="true" />
          {title}
        </Button>
      ))}
    </div>
  );
}
