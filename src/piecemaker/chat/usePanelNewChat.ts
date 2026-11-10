import { useEffect } from 'react';

import { useOptionalProjectCommandState } from '@/modules/project-workspace/context/ProjectsStateContext';

const PANEL_NEW_CHAT_EVENT = 'piecemaker:panel-new-chat';

export function usePanelNewChat(tab: string) {
  const command = useOptionalProjectCommandState();
  const project = command?.selectedProject;
  const newChat = command?.handleNewSession;

  useEffect(() => {
    if (!project || !newChat) return;
    const open = (event: Event) => {
      if ((event as CustomEvent<{ tab?: string }>).detail?.tab === tab) newChat(project);
    };
    window.addEventListener(PANEL_NEW_CHAT_EVENT, open);
    return () => window.removeEventListener(PANEL_NEW_CHAT_EVENT, open);
  }, [tab, project, newChat]);
}
