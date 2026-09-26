import { createRoot } from 'react-dom/client';

import { fetchShellEnvironment } from '@/piecemaker/shell-environment/api';
import { ShellEnvironmentWarning } from '@/piecemaker/shell-environment/ShellEnvironmentWarning';
import { AUTH_TOKEN_REFRESHED_EVENT } from '@/shared/authToken';
import '@/piecemaker/shell-environment/shell-environment.css';

export function startShellEnvironmentWarning() {
  let host: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;
  let settled = false;
  const dismiss = () => {
    root?.unmount();
    host?.remove();
    root = null;
    host = null;
  };
  const check = async () => {
    if (settled) return;
    const state = await fetchShellEnvironment().catch(() => null);
    if (!state) return;
    settled = true;
    if (state.status !== 'failed') return;
    host = document.createElement('div');
    host.id = 'piecemaker-shell-warning';
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(<ShellEnvironmentWarning shell={state.shell} reason={state.reason} onDismiss={dismiss} />);
  };
  const checkAfterLogin = () => { void check(); };
  window.addEventListener(AUTH_TOKEN_REFRESHED_EVENT, checkAfterLogin);
  void check();
  return () => {
    window.removeEventListener(AUTH_TOKEN_REFRESHED_EVENT, checkAfterLogin);
    dismiss();
  };
}
