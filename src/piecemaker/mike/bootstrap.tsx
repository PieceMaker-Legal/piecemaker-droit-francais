import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { AUTH_SESSION_EXPIRED_EVENT, AUTH_TOKEN_REFRESHED_EVENT, getStoredAuthToken } from '@/shared/authToken';
import { Button } from '@/shared/ui';
import { closeMikeSession, openMikePage } from '@/piecemaker/mike/api';
import { appendMikeWorkflowDraft, MikeComposerActions } from '@/piecemaker/mike/ComposerActions';
import { Organisation } from '@/piecemaker/mike/Organisation';
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
    if (wrapper instanceof HTMLElement && wrapper.classList.contains('md:block') && !wrapper.closest('[data-pm-mike-workspace]')) return wrapper;
  }
  return null;
}

function findWorkspace() {
  const tablist = [...document.querySelectorAll<HTMLElement>('[role="tablist"]')].find((element) => !element.closest('[data-pm-mike-workspace]'));
  return tablist?.closest<HTMLElement>('div.flex.h-full.flex-col') ?? document.querySelector<HTMLElement>('div.flex.min-w-0.flex-1.flex-col > div.flex.h-full.flex-col');
}

function MikeWorkspace({ navigation, workspace }: { navigation: HTMLElement; workspace: HTMLElement | null }) {
  const bridge = useSyncExternalStore(subscribeWorkflowSessionBridge, workflowSessionBridge);
  const [page, setPage] = useState<string | null>(null);
  const [frameUrl, setFrameUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const previousPathname = useRef(bridge.pathname);
  const frame = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (previousPathname.current !== bridge.pathname) setPage(null);
    previousPathname.current = bridge.pathname;
  }, [bridge.pathname, page]);

  useEffect(() => {
    if (!workspace) return;
    workspace.classList.toggle('piecemaker-mike-open', !!page);
    return () => workspace.classList.remove('piecemaker-mike-open');
  }, [page, workspace]);

  useEffect(() => {
    if (!page || page === '/organisation') return;
    let cancelled = false;
    setLoading(true);
    setError('');
    void openMikePage(page).then((url) => { if (!cancelled) setFrameUrl(url); }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Ouverture impossible.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page]);

  useEffect(() => {
    if (!workspace) return;
    const message = (event: MessageEvent) => {
      if (!frameUrl || event.source !== frame.current?.contentWindow || event.origin !== new URL(frameUrl).origin) return;
      if (event.data?.type === 'piecemaker-mike-navigation' && typeof event.data.path === 'string') workspace.dataset.mikePage = event.data.path;
      if (event.data?.type === 'piecemaker-mike-workflow-selected' && event.data.workflow?.metadata?.type === 'assistant') {
        appendMikeWorkflowDraft(event.data.workflow);
        setPage(null);
      }
    };
    window.addEventListener('message', message);
    return () => window.removeEventListener('message', message);
  }, [frameUrl, workspace]);

  return <>
    <MikeComposerActions enabled={!!bridge.projectPath && !bridge.pathname.startsWith('/session/')} />
    {createPortal(<nav aria-label="Espaces PieceMaker" className="flex flex-col gap-1">
      {entries.map((entry) => <button key={entry.path} type="button" onClick={() => setPage(entry.path)} aria-current={page === entry.path ? 'page' : undefined} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
        <img src={`/piecemaker/mike/${entry.icon}.svg`} className="h-3.5 w-3.5 grayscale" alt="" />
        <span className="text-sm">{entry.title}</span>
      </button>)}
    </nav>, navigation)}
    {page && workspace && createPortal(<section data-pm-mike-workspace="true" className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 justify-end border-b border-border/40 px-2 py-1">
        <Button size="sm" variant="ghost" onClick={() => setPage(null)}>Revenir à la session</Button>
      </div>
      {page === '/organisation' ? <Organisation projectPath={bridge.projectPath} /> : <div className="relative min-h-0 flex-1">
        {loading && <div role="status" className="absolute inset-0 z-10 flex items-center justify-center bg-background text-sm text-muted-foreground">Ouverture de l’espace…</div>}
        {error ? <div role="alert" className="p-6"><p>{error}</p><Button className="mt-4" onClick={() => { const target = page; setPage(null); window.setTimeout(() => setPage(target), 0); }}>Réessayer</Button></div> : frameUrl && <iframe ref={frame} key={frameUrl} src={frameUrl} title={entries.find((entry) => entry.path === page)?.title || 'Assistant'} className="h-full w-full border-0" allow="clipboard-read; clipboard-write" />}
      </div>}
    </section>, workspace)}
  </>;
}

export function startMikeWorkspace() {
  const navigation = document.createElement('div');
  navigation.className = 'px-2 pt-1.5';
  const hiddenLinks = new Set<HTMLElement>();
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLDivElement | null = null;
  let renderedWorkspace: HTMLElement | null = null;
  let rendered = false;
  let scheduled = false;
  const clear = () => {
    void closeMikeSession().catch(() => {});
    root?.unmount();
    host?.remove();
    navigation.remove();
    hiddenLinks.forEach((link) => link.removeAttribute('data-pm-mike-replaced'));
    hiddenLinks.clear();
    root = null;
    host = null;
    renderedWorkspace = null;
    rendered = false;
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
    if (!root) {
      host = document.createElement('div');
      document.body.appendChild(host);
      root = createRoot(host);
    }
    const workspace = findWorkspace();
    if (rendered && renderedWorkspace === workspace) return;
    renderedWorkspace = workspace;
    rendered = true;
    root.render(<MikeWorkspace navigation={navigation} workspace={workspace} />);
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
