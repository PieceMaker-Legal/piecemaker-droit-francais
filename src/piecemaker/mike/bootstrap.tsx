import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

import { AUTH_SESSION_EXPIRED_EVENT } from '@/shared/authToken';
import { ThemeProvider } from '@/shared/context/ThemeContext';
import { MikeComposerActions } from '@/piecemaker/mike/ComposerActions';
import { setMikePage } from '@/piecemaker/mike/page';
import { subscribeWorkflowSessionBridge, workflowSessionBridge } from '@/piecemaker/mike/sessionBridge';

function MikeComposerBridge() {
  const bridge = useSyncExternalStore(subscribeWorkflowSessionBridge, workflowSessionBridge);
  return <MikeComposerActions enabled={!!bridge.projectPath && !bridge.pathname.startsWith('/session/')} />;
}

export function startMikeWorkspace() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(<ThemeProvider><MikeComposerBridge /></ThemeProvider>);
  const clear = () => setMikePage(null);
  window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, clear);
  return () => {
    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, clear);
    clear();
    root.unmount();
    host.remove();
  };
}
