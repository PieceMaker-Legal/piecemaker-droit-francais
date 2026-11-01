import { useEffect, useState } from 'react';

import { ChatInterface } from '@/modules/chat';
import { useProjectMainState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { openInEditor, sessionPath } from '@/piecemaker/editor-tabs/editorPanels';
import { api } from '@/shared/api';
import { useUiPreferences } from '@/shared/context/UiPreferencesContext';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { ProjectSession } from '@/shared/types';

const openFile = (path: string) => { openInEditor(path); };
const openSession = (id: string) => { openInEditor(sessionPath(id)); };

async function loadSession(id: string): Promise<ProjectSession | null> {
  const response = await api.sessionDetails(id);
  const details = (await response.json())?.data;
  if (!response.ok || !details?.sessionId) return null;
  return {
    id: details.sessionId,
    summary: details.summary,
    __provider: details.provider,
    __projectId: details.project?.projectId,
  };
}

function Notice({ children }: { children: string }) {
  return <div role="status" className="flex h-full items-center justify-center bg-background p-6 text-center text-sm text-muted-foreground">{children}</div>;
}

export function SessionTab({ id }: { id: string }) {
  const { selectedProject, openSettings } = useProjectMainState();
  const { ws, sendMessage } = useWebSocket();
  const { showRawParameters, showThinking, sendByCtrlEnter } = useUiPreferences();
  const [session, setSession] = useState<ProjectSession | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setSession(undefined);
    loadSession(id).catch(() => null).then((loaded) => {
      if (live) setSession(loaded);
    });
    return () => { live = false; };
  }, [id]);

  if (session === undefined) return null;
  if (!session) return <Notice>Impossible d’ouvrir cette conversation annexe.</Notice>;
  if (session.__projectId !== selectedProject?.projectId) return <Notice>Cette conversation annexe appartient à un autre dossier.</Notice>;

  return (
    <div className="h-full" data-side-conversation={id}>
      <ChatInterface
        isActive
        selectedProject={selectedProject}
        selectedSession={session}
        ws={ws}
        sendMessage={sendMessage}
        onFileOpen={openFile}
        onNavigateToSession={openSession}
        onShowSettings={openSettings}
        showRawParameters={showRawParameters}
        showThinking={showThinking}
        sendByCtrlEnter={sendByCtrlEnter}
      />
    </div>
  );
}
