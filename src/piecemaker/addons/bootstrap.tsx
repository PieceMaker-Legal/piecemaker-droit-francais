import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

import { AUTH_SESSION_EXPIRED_EVENT } from '@/shared/authToken';
import { ThemeProvider } from '@/shared/context/ThemeContext';
import { AddonsComposerActions } from '@/piecemaker/addons/ComposerActions';
import { AddonsWorkspaceOverlay } from '@/piecemaker/addons/AddonsWorkspaceOverlay';
import { setAddonsPage } from '@/piecemaker/addons/page';
import { subscribeWorkflowSessionBridge, workflowSessionBridge } from '@/piecemaker/addons/sessionBridge';

function AddonsComposerBridge() {
  const bridge = useSyncExternalStore(subscribeWorkflowSessionBridge, workflowSessionBridge);
  return <AddonsComposerActions enabled={!!bridge.projectPath && !bridge.pathname.startsWith('/session/')} />;
}

export function startAddonsWorkspace() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(<ThemeProvider><AddonsComposerBridge /><AddonsWorkspaceOverlay /></ThemeProvider>);
  const clear = () => setAddonsPage(null);
  window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, clear);
  return () => {
    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, clear);
    clear();
    root.unmount();
    host.remove();
  };
}
