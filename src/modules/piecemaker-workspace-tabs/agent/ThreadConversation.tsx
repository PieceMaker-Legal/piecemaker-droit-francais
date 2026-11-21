import { useEffect, useState } from 'react';

import { ChatInterface } from '@/modules/chat';
import { openInEditor, sessionPath } from '@/piecemaker/editor-tabs/editorPanels';
import { api } from '@/shared/api';
import { useUiPreferences } from '@/shared/context/UiPreferencesContext';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { Project, ProjectSession } from '@/shared/types';

export default function ThreadConversation({ sessionId, onShowSettings }: { sessionId: string; onShowSettings?: () => void }) {
  const { ws, sendMessage } = useWebSocket();
  const { showRawParameters, showThinking, sendByCtrlEnter } = useUiPreferences();
  const [conversation, setConversation] = useState<{ project: Project; session: ProjectSession } | null>();

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await api.sessionDetails(sessionId);
        if (!response.ok) throw new Error();
        const { data } = await response.json();
        if (!data?.sessionId || !data.project) throw new Error();
        if (active) setConversation({
          project: data.project,
          session: {
            id: data.sessionId,
            summary: data.summary,
            __provider: data.provider,
            __projectId: data.project.projectId,
          },
        });
      } catch {
        if (active) setConversation(null);
      }
    }
    void load();
    return () => { active = false; };
  }, [sessionId]);

  const loading = <p role="status" className="p-4 text-sm">Chargement de la session…</p>;
  if (conversation === undefined) return loading;
  if (!conversation) return <p role="alert" className="p-4 text-sm">Impossible d’ouvrir la session.</p>;

  return <div className="min-h-0 flex-1 overflow-hidden">
    <ChatInterface
      isActive
      selectedProject={conversation.project}
      selectedSession={conversation.session}
      ws={ws}
      sendMessage={sendMessage}
      onFileOpen={(path) => openInEditor(path)}
      onNavigateToSession={(id) => { if (id !== conversation.session.id) openInEditor(sessionPath(id)); }}
      onShowSettings={onShowSettings}
      showRawParameters={showRawParameters}
      showThinking={showThinking}
      sendByCtrlEnter={sendByCtrlEnter}
    />
  </div>;
}
