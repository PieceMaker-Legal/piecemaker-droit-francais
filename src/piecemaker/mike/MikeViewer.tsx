/**
 * Visionneuse Mike, montée par `WorkspaceMain` dans l'arbre React de CloudCLI :
 * elle occupe la zone de l'onglet actif tant qu'une page Mike est ouverte, et
 * se referme d'elle-même quand le dossier ou la session change, sans observer
 * le DOM de l'hôte.
 */
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { Button } from '@/shared/ui';
import { closeMikeSession, openMikePage } from '@/piecemaker/mike/api';
import { Organisation } from '@/piecemaker/mike/Organisation';
import { setMikePage, useMikePage } from '@/piecemaker/mike/page';
import { appendMikeWorkflowDraft } from '@/piecemaker/mike/ComposerActions';
import '@/piecemaker/mike/workspace.css';

export function MikeViewer({ projectPath }: { projectPath?: string | null }) {
  const page = useMikePage();
  const { pathname } = useLocation();
  const [frameUrl, setFrameUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const frame = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => () => { setMikePage(null); }, []);

  useEffect(() => { setMikePage(null); }, [projectPath, pathname]);

  useEffect(() => {
    if (!page || page === '/organisation') return;
    let cancelled = false;
    setLoading(true);
    setError('');
    void openMikePage(page)
      .then((url) => { if (!cancelled) setFrameUrl(url); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Ouverture impossible.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page]);

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
      <div className="flex shrink-0 justify-end border-b border-border/40 px-2 py-1">
        <Button size="sm" variant="ghost" onClick={() => setMikePage(null)}>Revenir à la session</Button>
      </div>
      {page === '/organisation' ? <Organisation projectPath={projectPath ?? null} /> : (
        <div className="relative min-h-0 flex-1">
          {loading && <div role="status" className="absolute inset-0 z-10 flex items-center justify-center bg-background text-sm text-muted-foreground">Ouverture de l’espace…</div>}
          {error ? (
            <div role="alert" className="p-6">
              <p>{error}</p>
              <Button className="mt-4" onClick={() => { const target = page; setMikePage(null); window.setTimeout(() => setMikePage(target), 0); }}>Réessayer</Button>
            </div>
          ) : frameUrl && <iframe ref={frame} key={frameUrl} src={frameUrl} title="Espace Mike" className="h-full w-full border-0" allow="clipboard-read; clipboard-write" />}
        </div>
      )}
    </section>
  );
}
