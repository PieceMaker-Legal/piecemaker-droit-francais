import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import { MikeViewer } from '@/piecemaker/mike/MikeViewer';
import { useMikePage } from '@/piecemaker/mike/page';
import { subscribeWorkflowSessionBridge, workflowSessionBridge } from '@/piecemaker/mike/sessionBridge';

export function MikeWelcomeViewer() {
  const page = useMikePage();
  const { projectPath } = useSyncExternalStore(subscribeWorkflowSessionBridge, workflowSessionBridge);
  const [workspace, setWorkspace] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (projectPath || !page) {
      setWorkspace(null);
      return;
    }
    const findWorkspace = () => {
      const nextWorkspace = document.querySelector<HTMLElement>('.fixed.inset-0.flex.bg-background > .flex.min-w-0.flex-1.flex-col');
      setWorkspace((currentWorkspace) => currentWorkspace === nextWorkspace ? currentWorkspace : nextWorkspace);
    };
    findWorkspace();
    const observer = new MutationObserver(findWorkspace);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [page, projectPath]);

  if (projectPath || !page || !workspace) return null;

  return createPortal(<div data-pm-mike-welcome="true"><MikeViewer /></div>, workspace);
}
