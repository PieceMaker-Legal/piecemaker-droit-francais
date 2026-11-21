import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { ChatInterface } from '@/modules/chat';
import { useProjectMainState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { openInEditor, sessionPath } from '@/piecemaker/editor-tabs/editorPanels';
import { api } from '@/shared/api';
import { useUiPreferences } from '@/shared/context/UiPreferencesContext';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { ProjectSession } from '@/shared/types';

const openFile = (path: string) => { openInEditor(path); };
const openSession = (id: string) => { openInEditor(sessionPath(id)); };

const FORK_COPY_MARGIN_MS = 1000;
const HIDE_HISTORY_NOTICES = '[&_.chat-messages-pane>.space-y-3>.border-b]:hidden [&_.chat-messages-pane>.space-y-3>.py-3]:hidden [&_.chat-messages-pane>.space-y-3>.sticky]:hidden';

type SideConversation = { session: ProjectSession; historyEnd: number };

function hideRowsBefore(container: HTMLElement, historyEnd: number): void {
  container.querySelectorAll<HTMLElement>('[data-message-timestamp]').forEach((row) => {
    row.hidden = Date.parse(row.dataset.messageTimestamp ?? '') < historyEnd;
  });
}

async function loadSession(id: string): Promise<SideConversation | null> {
  const response = await api.sessionDetails(id);
  const details = (await response.json())?.data;
  if (!response.ok || !details?.sessionId) return null;
  return {
    session: {
      id: details.sessionId,
      summary: details.summary,
      __provider: details.provider,
      __projectId: details.project?.projectId,
    },
    historyEnd: Date.parse(details.createdAt) + FORK_COPY_MARGIN_MS,
  };
}

function Notice({ children }: { children: string }) {
  return <div role="status" className="flex h-full items-center justify-center bg-background p-6 text-center text-sm text-muted-foreground">{children}</div>;
}

export function SessionTab({ id, fullHistory = false }: { id: string; fullHistory?: boolean }) {
  const { selectedProject, openSettings } = useProjectMainState();
  const { ws, sendMessage } = useWebSocket();
  const { showRawParameters, showThinking, sendByCtrlEnter } = useUiPreferences();
  const [loaded, setLoaded] = useState<SideConversation | null | undefined>(undefined);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    setLoaded(undefined);
    loadSession(id).catch(() => null).then((conversation) => {
      if (live) setLoaded(conversation);
    });
    return () => { live = false; };
  }, [id]);

  useLayoutEffect(() => {
    const element = container.current;
    if (!element || !loaded || fullHistory) return undefined;
    const hide = () => hideRowsBefore(element, loaded.historyEnd);
    hide();
    const observer = new MutationObserver(hide);
    observer.observe(element, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [fullHistory, loaded]);

  if (loaded === undefined) return fullHistory ? <Notice>Chargement de la session…</Notice> : null;
  if (!loaded) return <Notice>{fullHistory ? 'Impossible d’ouvrir cette session.' : 'Impossible d’ouvrir cette conversation annexe.'}</Notice>;
  const { session } = loaded;
  if (session.__projectId !== selectedProject?.projectId) {
    return <Notice>{fullHistory ? 'Cette session appartient à un autre dossier.' : 'Cette conversation annexe appartient à un autre dossier.'}</Notice>;
  }

  return (
    <div ref={container} className={`flex h-full min-h-0 flex-col ${fullHistory ? '' : HIDE_HISTORY_NOTICES}`} data-side-conversation={id}>
      {fullHistory && <h2 className="shrink-0 truncate border-b py-3 pl-4 pr-12 text-sm font-medium">{session.summary || 'Session de création'}</h2>}
      <div className="min-h-0 flex-1">
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
    </div>
  );
}
