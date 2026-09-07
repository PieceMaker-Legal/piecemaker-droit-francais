import { ChevronLeft, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { Button } from '@/shared/ui';
import { closeMikeSession, openMikePage } from '@/piecemaker/mike/api';
import { Organisation } from '@/piecemaker/mike/Organisation';
import { MIKE_PAGES, setMikePage, useMikePage } from '@/piecemaker/mike/page';
import { appendMikeWorkflowDraft } from '@/piecemaker/mike/ComposerActions';
import '@/piecemaker/mike/workspace.css';

function getPageTitle(page: string) {
  return MIKE_PAGES.find((entry) => entry.path === page)?.title ?? 'Espace Mike';
}

export function MikeViewer({ projectPath }: { projectPath?: string | null }) {
  const page = useMikePage();
  const { pathname } = useLocation();
  const [frameUrl, setFrameUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const frame = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => () => { setMikePage(null); }, []);

  const previousContext = useRef({ projectPath, pathname });

  useEffect(() => {
    if (previousContext.current.projectPath !== projectPath || previousContext.current.pathname !== pathname) {
      setMikePage(null);
    }
    previousContext.current = { projectPath, pathname };
  }, [projectPath, pathname]);

  useEffect(() => {
    if (!page || page === '/organisation') return;
    let cancelled = false;
    setFrameUrl('');
    setLoading(true);
    setError('');
    void openMikePage(page)
      .then((url) => { if (!cancelled) setFrameUrl(url); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Ouverture impossible.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, reloadVersion]);

  useEffect(() => {
    if (page) return;
    setFrameUrl('');
    void closeMikeSession().catch(() => {});
  }, [page]);

  useEffect(() => {
    if (!frameUrl) return;
    const message = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== new URL(frameUrl).origin) return;
      if (event.data?.type === 'piecemaker-mike-workflow-selected' && event.data.workflow?.metadata?.type === 'assistant') {
        appendMikeWorkflowDraft(event.data.workflow);
        setMikePage(null);
      }
    };
    window.addEventListener('message', message);
    return () => window.removeEventListener('message', message);
  }, [frameUrl]);

  if (!page) return null;
  return (
    <section data-pm-mike-viewer="true" aria-label="Espace PieceMaker" className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/40 px-3 py-2">
        <Button size="sm" variant="ghost" onClick={() => setMikePage(null)}><ChevronLeft className="h-4 w-4" />{projectPath ? 'Revenir à la session' : 'Revenir à l’accueil'}</Button>
        <div className="h-5 border-l border-border/60" aria-hidden="true" />
        <nav aria-label="Navigation Mike" className="flex flex-wrap items-center gap-1">
          {MIKE_PAGES.map((entry) => <Button key={entry.path} size="sm" variant={page === entry.path ? 'secondary' : 'ghost'} onClick={() => setMikePage(entry.path)} aria-current={page === entry.path ? 'page' : undefined}>{entry.title}</Button>)}
        </nav>
        <h1 className="ml-auto text-sm font-medium">{getPageTitle(page)}</h1>
      </div>
      {page === '/organisation' ? <Organisation projectPath={projectPath ?? null} /> : (
        <div className="relative min-h-0 flex-1">
          {loading && <div role="status" className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Ouverture de l’espace…</div>}
          {error ? (
            <div role="alert" className="p-6">
              <p>{error}</p>
              <Button className="mt-4" onClick={() => setReloadVersion((version) => version + 1)}>Réessayer</Button>
            </div>
          ) : frameUrl && <iframe ref={frame} key={frameUrl} src={frameUrl} title="Espace Mike" className="h-full w-full border-0" allow="clipboard-read; clipboard-write" />}
        </div>
      )}
    </section>
  );
}
