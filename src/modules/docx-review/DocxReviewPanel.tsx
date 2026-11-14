import { useCallback, useEffect, useState } from 'react';
import { DocxEditor } from '@eigenpal/docx-editor-react';
import fr from '@eigenpal/docx-editor-i18n/fr';

import { EditCardUI } from '@/modules/docx-review/EditCardUI';
import { docxReviewRequest, docxReviewSnapshot } from '@/shared/api';
import type { DocxEditAnnotation, DocxReview } from '@/shared/types';
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/Dialog';

/** Utilisé par la visionneuse Word pour les versions et propositions Mike. */
export function DocxReviewPanel({ projectId, path, beforeChange, onChanged, onView }: {
  projectId: string; path: string; beforeChange(): Promise<boolean>; onChanged(): Promise<void>; onView(edit: DocxEditAnnotation): void;
}) {
  // Le registre contient les versions et décisions persistées côté serveur.
  const [review, setReview] = useState<DocxReview | null>(null);
  // Une décision empêche les clics concurrents depuis les cartes.
  const [busy, setBusy] = useState<string | null>(null);
  // Les erreurs restent visibles sans fermer le document.
  const [error, setError] = useState('');
  // Une ancienne version s’ouvre en lecture seule sans changer la version active.
  const [snapshot, setSnapshot] = useState<ArrayBuffer | null>(null);
  const refresh = useCallback(async () => setReview(await docxReviewRequest(projectId, path)), [projectId, path]);
  useEffect(() => {
    let live = true;
    const load = () => { void docxReviewRequest(projectId, path).then((value) => { if (live) setReview(value); }).catch(() => {}); };
    load();
    const timer = window.setInterval(load, 2000);
    return () => { live = false; window.clearInterval(timer); };
  }, [projectId, path]);
  const resolve = async (edit: DocxEditAnnotation, action: 'accept' | 'reject') => {
    if (busy) return;
    setBusy(edit.edit_id); setError('');
    try {
      if (!await beforeChange()) return;
      const current = await docxReviewRequest(projectId, path);
      setReview(await docxReviewRequest(projectId, path, { action, edit_id: edit.edit_id, expected_sha256: current.sha256 }));
      await onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Décision impossible.'); }
    finally { setBusy(null); }
  };
  if (!review?.versions.length) return null;
  return <aside className="w-72 shrink-0 overflow-y-auto border-l border-border p-3" aria-label="Propositions Word">
    <label className="block text-sm">Versions<select aria-label="Versions Word" className="my-2 w-full rounded-md bg-muted p-2 text-sm" value={review.current_version_id ?? ''} onChange={(event) => {
      const id = event.target.value;
      if (id === review.current_version_id) return;
      void beforeChange().then(async (saved) => { if (saved) setSnapshot(await docxReviewSnapshot(projectId, path, id)); }).catch(() => setError('Version indisponible.'));
    }}>{review.versions.map((version) => <option key={version.id} value={version.id}>Version {version.version_number}{version.id === review.current_version_id ? ' · active' : ''}</option>)}</select></label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="space-y-4">{review.annotations.map((edit, index) => <EditCardUI key={edit.edit_id} originalText={edit.deleted_text} replacementText={edit.inserted_text}
      reason={edit.reason} changeNumber={index + 1} status={edit.status} actionsDisabled={busy !== null} ariaBusy={busy === edit.edit_id}
      onView={() => onView(edit)} onAccept={() => void resolve(edit, 'accept')} onReject={() => void resolve(edit, 'reject')} />)}</div>
    <Dialog open={snapshot !== null} onOpenChange={(open) => { if (!open) { setSnapshot(null); void refresh().catch(() => setError('Versions indisponibles.')); } }}><DialogContent aria-label="Ancienne version Word" wrapperClassName="z-[10000]" className="flex h-[90vh] max-w-[95vw] flex-col">
      <DialogTitle>Ancienne version Word</DialogTitle>
      {snapshot && <DocxEditor documentBuffer={snapshot} mode="viewing" showFileOpen={false} i18n={fr} style={{ flex: 1, minHeight: 0 }} />}
    </DialogContent></Dialog>
  </aside>;
}
