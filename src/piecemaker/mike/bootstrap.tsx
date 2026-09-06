import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { AUTH_SESSION_EXPIRED_EVENT, AUTH_TOKEN_REFRESHED_EVENT, getStoredAuthToken } from '@/shared/authToken';
import { ThemeProvider } from '@/shared/context/ThemeContext';
import { MikeComposerActions } from '@/piecemaker/mike/ComposerActions';
import { setMikePage, useMikePage } from '@/piecemaker/mike/page';
import { subscribeWorkflowSessionBridge, workflowSessionBridge } from '@/piecemaker/mike/sessionBridge';
import '@/piecemaker/mike/workspace.css';

const entries = [
  { path: '/workflows', title: 'Workflows', icon: 'workflow' },
  { path: '/tabular-reviews', title: 'Tabular review', icon: 'tabular-review' },
  { path: '/library', title: 'Library', icon: 'library' },
  { path: '/organisation', title: 'Organisation', icon: 'organization' },
];

const FOOTER_LINK_SELECTOR = 'a[href="https://discord.gg/buxwujPNRE"], a[href="https://github.com/PieceMaker-Legal/piecemaker-droit-francais/issues/new"]';

function findSidebarFooterSlot() {
  for (const link of document.querySelectorAll<HTMLAnchorElement>(FOOTER_LINK_SELECTOR)) {
    const wrapper = link.parentElement;
    if (wrapper instanceof HTMLElement && wrapper.classList.contains('md:block')) return wrapper;
  }
  return null;
}

function MikeNavigation({ navigation }: { navigation: HTMLElement }) {
  const bridge = useSyncExternalStore(subscribeWorkflowSessionBridge, workflowSessionBridge);
  const page = useMikePage();

  return <>
    <MikeComposerActions enabled={!!bridge.projectPath && !bridge.pathname.startsWith('/session/')} />
    {createPortal(<nav aria-label="Espaces PieceMaker" className="flex flex-col gap-1">
      {entries.map((entry) => <button key={entry.path} type="button" onClick={() => setMikePage(entry.path)} aria-current={page === entry.path ? 'page' : undefined} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
        <img src={`/piecemaker/mike/${entry.icon}.svg`} className="h-3.5 w-3.5 grayscale" alt="" />
        <span className="text-sm">{entry.title}</span>
      </button>)}
    </nav>, navigation)}
  </>;
}

export function startMikeWorkspace() {
  const navigation = document.createElement('div');
  navigation.className = 'px-2 pt-1.5';
  const hiddenLinks = new Set<HTMLElement>();
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  let scheduled = false;
  const clear = () => {
    setMikePage(null);
    root?.unmount();
    host?.remove();
    navigation.remove();
    hiddenLinks.forEach((link) => link.removeAttribute('data-pm-mike-replaced'));
    hiddenLinks.clear();
    root = null;
    host = null;
  };
  const refresh = () => {
    scheduled = false;
    if (!getStoredAuthToken()) { if (root) clear(); return; }
    const slot = findSidebarFooterSlot();
    if (!slot) return;
    if (navigation.nextSibling !== slot) slot.before(navigation);
    slot.parentElement?.querySelectorAll<HTMLElement>(FOOTER_LINK_SELECTOR).forEach((link) => {
      link.setAttribute('data-pm-mike-replaced', 'true');
      hiddenLinks.add(link);
    });
    if (root) return;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(<ThemeProvider><MikeNavigation navigation={navigation} /></ThemeProvider>);
  };
  const schedule = () => { if (!scheduled) { scheduled = true; queueMicrotask(refresh); } };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener(AUTH_TOKEN_REFRESHED_EVENT, schedule);
  window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, clear);
  window.addEventListener('storage', schedule);
  refresh();
  return () => {
    observer.disconnect();
    window.removeEventListener(AUTH_TOKEN_REFRESHED_EVENT, schedule);
    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, clear);
    window.removeEventListener('storage', schedule);
    clear();
  };
}
