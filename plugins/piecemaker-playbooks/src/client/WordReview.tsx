import React, { useEffect, useRef, useState } from 'react';
import { DocxEditor, type DocxEditorRef } from '@eigenpal/docx-editor-react';
import fr from '@eigenpal/docx-editor-i18n/fr';
import { EditCardUI } from '../../../../src/modules/docx-review/EditCardUI.js';
import type { DocxReview } from '../../../../shared/piecemaker/docx-review.js';
import type { Run } from '../shared.js';
import { decodeBuffer, encodeBuffer } from './word.js';

export type Rpc = <T>(method: string, path: string, body?: unknown) => Promise<T>;

export function WordReview({ run, rpc, onRun, onError, onDirty }: { run: Run; rpc: Rpc; onRun(run: Run): void; onError(message: string): void; onDirty(dirty: boolean): void }) {
  const editor = useRef<DocxEditorRef>(null);
  const hash = useRef('');
  const dirty = useRef(false);
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [review, setReview] = useState<DocxReview | null>(null);
  const editVersion = useRef(0);

  useEffect(() => { onDirty(changed); return () => onDirty(false); }, [changed, onDirty]);

  useEffect(() => {
    let live = true;
    Promise.all([rpc<{ buffer: string; hash: string }>('GET', `/runs/${run.id}/document`), rpc<{ css: string }>('GET', '/editor-style')])
      .then(([document, styles]) => {
        if (!live) return;
        const style = window.document.getElementById('piecemaker-playbooks-eigenpal-style') ?? window.document.createElement('style');
        style.id = 'piecemaker-playbooks-eigenpal-style'; style.textContent = styles.css;
        if (!style.isConnected) window.document.head.append(style);
        hash.current = document.hash; dirty.current = false; setChanged(false); setBuffer(decodeBuffer(document.buffer));
        void rpc<DocxReview>('GET', `/runs/${run.id}/edits`).then((value) => { if (live) setReview(value); })
          .catch(() => { if (live) onError('Les propositions Word sont indisponibles.'); });
      }).catch((error) => { if (live) onError(error instanceof Error ? error.message : 'Impossible d’ouvrir Word.'); });
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { live = false; window.removeEventListener('beforeunload', beforeUnload); };
  }, [run.id, rpc, onError]);

  const persist = async (findingId?: string) => {
    const version = editVersion.current;
    const bytes = await editor.current?.save();
    if (!bytes) throw new Error('Le document Word n’est pas prêt.');
    const result = await rpc<{ hash: string; run: Run }>('PUT', `/runs/${run.id}/document`, { buffer: encodeBuffer(bytes), expectedHash: hash.current, findingId });
    hash.current = result.hash; dirty.current = editVersion.current !== version; setChanged(dirty.current); onRun(result.run);
  };

  const save = async () => {
    setBusy(true);
    try { await persist(); } catch (error) { onError(error instanceof Error ? error.message : 'Enregistrement impossible.'); }
    finally { setBusy(false); }
  };

  const updateEdits = async (body: { findingId?: string; action?: 'accept' | 'reject'; edit_id?: string }) => {
    if (!editor.current || busy) return;
    setBusy(true);
    try {
      if (dirty.current) throw new Error('Enregistrez vos modifications Word avant d’appliquer une proposition.');
      const result = await rpc<{ review: DocxReview; run: Run; buffer: string }>('POST', `/runs/${run.id}/edits`, { ...body, expectedHash: hash.current });
      hash.current = result.review.sha256; setReview(result.review); setBuffer(decodeBuffer(result.buffer)); onRun(result.run);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Proposition impossible.');
    } finally { setBusy(false); }
  };

  return <section className="panel">
    <div className="bar"><h2>Copie Word — Eigenpal</h2><button type="button" disabled={!changed || busy} onClick={() => void save()}>Enregistrer les révisions</button><span className="muted">{changed ? 'Modifications non enregistrées' : 'Copie enregistrée'}</span></div>
    <p className="muted">La pièce originale reste intacte. Acceptez ou refusez les révisions dans le panneau des modifications de Word.</p>
    {buffer ? <div className="word"><DocxEditor ref={editor} documentBuffer={buffer} author="PieceMaker" i18n={fr}
      showFileOpen={false} colorMode="light" onChange={() => { editVersion.current += 1; dirty.current = true; setChanged(true); }}
      onError={(error) => onError(error.message)} /></div> : <p role="status">Chargement du document Word…</p>}
    <div className="actions">{run.findings.filter((finding) => finding.suggestedText).map((finding) =>
      <button type="button" key={finding.id} disabled={busy || !buffer || finding.applied || !finding.verified || changed}
        onClick={() => void updateEdits({ findingId: finding.id })}>{finding.applied ? 'Proposée dans Word' : 'Proposer dans Word'} : {finding.ruleName}</button>)}</div>
    <div className="grid">{review?.annotations.map((edit, index) => <EditCardUI key={edit.edit_id} originalText={edit.deleted_text} replacementText={edit.inserted_text}
      reason={edit.reason} changeNumber={index + 1} status={edit.status} actionsDisabled={busy || changed}
      onAccept={() => void updateEdits({ action: 'accept', edit_id: edit.edit_id })} onReject={() => void updateEdits({ action: 'reject', edit_id: edit.edit_id })}
      onView={() => { const id = edit.ins_w_id ?? edit.del_w_id; if (id) editor.current?.getEditorRef()?.scrollToChangeId(Number(id)); }} />)}</div>
  </section>;
}
