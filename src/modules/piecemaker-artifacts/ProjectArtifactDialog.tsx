import { X } from 'lucide-react';
import { lazy, Suspense, useCallback, useId, useRef } from 'react';

import { ProjectArtifact } from '@/modules/piecemaker-artifacts/ArtifactsPanel';
import { useArtifactResource } from '@/modules/piecemaker-artifacts/hooks/useArtifactResource';
import { DocxSaveContext } from '@/piecemaker/docx';
import { artifactsApi } from '@/shared/api';
import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';

const SessionTab = lazy(async () => ({ default: (await import('@/piecemaker/editor-tabs/SessionTab')).SessionTab }));

export function ProjectArtifactDialog({ project, projectId, artifact, associatedSessionId, onClose }: {
  project: string;
  projectId: string;
  artifact: { id: string; title: string };
  associatedSessionId: string | null;
  onClose: () => void;
}) {
  const titleId = useId();
  const loadCreator = useCallback(() => artifactsApi.creator(project, artifact.id), [project, artifact.id]);
  const { value: creator, error: creatorError } = useArtifactResource(loadCreator);
  const loadingCreator = !creator && !creatorError;
  const sessionId = loadingCreator ? null : creator?.sessionId ?? associatedSessionId;
  const dirty = useRef(false);
  const saveDocument = useRef<(() => Promise<boolean>) | null>(null);
  const registerSave = useCallback((save: () => Promise<boolean>) => {
    saveDocument.current = save;
    return () => { if (saveDocument.current === save) saveDocument.current = null; };
  }, []);
  const setDirty = useCallback((value: boolean) => { dirty.current = value; }, []);

  const close = async () => {
    if (dirty.current && !window.confirm('Fermer sans enregistrer les modifications du fichier HTML ?')) return;
    if (saveDocument.current && !await saveDocument.current()) return;
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) void close(); }}>
      <DialogContent aria-labelledby={titleId} className="grid h-dvh w-screen max-w-none grid-rows-[3fr_2fr] overflow-hidden rounded-none md:h-[calc(100dvh-2rem)] md:w-[calc(100vw-2rem)] md:grid-cols-[2fr_1fr] md:grid-rows-1 md:rounded-xl">
        <DialogTitle id={titleId}>{artifact.title}</DialogTitle>
        <div className="min-h-0 min-w-0 overflow-hidden" aria-label="Artifact">
          <DocxSaveContext.Provider value={registerSave}>
            <ProjectArtifact project={project} projectId={projectId} id={artifact.id} onClose={onClose} onDirty={setDirty} />
          </DocxSaveContext.Provider>
        </div>
        <aside className="relative flex min-h-0 min-w-0 flex-col overflow-hidden border-t md:border-l md:border-t-0"
          aria-label={sessionId && !creator?.sessionId ? 'Fil associé' : 'Session de création'}>
          <Button type="button" variant="ghost" size="icon" aria-label="Fermer l’artifact"
            className="absolute right-2 top-1 z-10" onClick={() => void close()}><X /></Button>
          {sessionId && !creator?.sessionId && <p className="border-b px-4 py-2 text-xs text-muted-foreground">Fil associé</p>}
          {sessionId ? <Suspense fallback={<p role="status" className="p-4 text-sm">Chargement de la session…</p>}>
            <div className="min-h-0 flex-1"><SessionTab key={sessionId} id={sessionId} fullHistory /></div>
          </Suspense> : <p role="status" className="p-4 pr-12 text-sm text-muted-foreground">
            {loadingCreator ? 'Recherche de la session de création…' : 'Session de création inconnue.'}
          </p>}
        </aside>
      </DialogContent>
    </Dialog>
  );
}
