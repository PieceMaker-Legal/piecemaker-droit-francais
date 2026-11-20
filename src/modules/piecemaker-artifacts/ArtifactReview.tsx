import { useState } from 'react';
import { Check, Highlighter, MessageSquare, RotateCcw } from 'lucide-react';

import { ArtifactState } from '@/modules/piecemaker-artifacts/ArtifactState';
import { artifactsApi } from '@/shared/api';
import { Badge, Button, Card, CardContent, CardHeader, Input } from '@/shared/ui';
import type { ArtifactDecision, ArtifactPassage, ArtifactThread } from '@/shared/types';

type ReviewProps = {
  project: string;
  id: string;
  version: number;
  threads: ArtifactThread[] | undefined;
  error: string;
  selection: ArtifactPassage | null;
  missingPassage: string | null;
  clearSelection: () => void;
  focusPassage: (id: string) => void;
  refresh: () => Promise<void>;
};

export function ArtifactReview({
  project, id, version, threads, error, selection, missingPassage, clearSelection, focusPassage, refresh,
}: ReviewProps) {
  const [note, setNote] = useState('');
  const [feedback, setFeedback] = useState('');
  const [reply, setReply] = useState<{ id: string; text: string } | null>(null);
  const [actionError, setActionError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (write: () => Promise<unknown>, reset: () => void) => {
    setSaving(true);
    setActionError('');
    try {
      await write();
      reset();
      await refresh();
    } catch (failure) {
      setActionError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveNote = (text: string) => save(
    () => artifactsApi.comment(project, id, { text, anchor: { version, ...(selection && { passage: selection }) } }),
    () => { setNote(''); clearSelection(); },
  );

  const decide = (decision: ArtifactDecision) => save(
    () => artifactsApi.decide(project, id, { version, decision, text: feedback }),
    () => setFeedback(''),
  );

  return (
    <aside aria-label={`Revue de la version ${version}`} className="min-h-0 basis-1/2 overflow-auto border-t bg-background">
      <div className="space-y-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium">Revue · v{version}</h3>
          <p className="text-sm text-muted-foreground">Sélectionnez un passage dans la page pour le surligner ou l’annoter.</p>
        </div>
        {error && <ArtifactState error={error} retry={() => void refresh()} />}
        {actionError && <ArtifactState error={actionError} />}
        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); if (note.trim()) void saveNote(note); }}>
          {selection && (
            <div className="space-y-2 rounded-md border bg-muted/50 p-2">
              <blockquote className="whitespace-pre-wrap break-words text-sm">{selection.quote}</blockquote>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void saveNote('Passage surligné.')}><Highlighter /> Surligner</Button>
                <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={clearSelection}>Retirer la sélection</Button>
              </div>
            </div>
          )}
          <label className="block text-sm font-medium" htmlFor="artifact-note">{selection ? 'Annotation du passage' : 'Commentaire sur la version'}</label>
          <textarea id="artifact-note" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" rows={2} maxLength={16000} value={note} onChange={(event) => setNote(event.target.value)} />
          <Button size="sm" disabled={saving || !note.trim()}><MessageSquare /> {selection ? 'Ajouter l’annotation' : 'Ajouter le commentaire'}</Button>
        </form>
        {!threads && !error && <ArtifactState />}
        {threads?.length === 0 && <p className="text-sm text-muted-foreground">Aucun commentaire sur cette version.</p>}
        {threads?.map((thread) => {
          const decision = thread.anchor?.decision;
          const passage = thread.anchor?.passage;
          return (
            <Card key={thread.id}>
              {(decision || thread.resolved || passage) && <CardHeader className="gap-2 p-3">
                {(decision || thread.resolved) && <div className="flex flex-wrap items-center gap-2">
                  {decision && <Badge variant={decision === 'approved' ? 'default' : 'secondary'}>{decision === 'approved' ? 'Approuvée' : 'Modifications demandées'}</Badge>}
                  {thread.resolved && <Badge variant="outline">Résolu</Badge>}
                </div>}
                {passage && (
                  <div className="space-y-1">
                    <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-2 text-sm text-muted-foreground">{passage.quote}</blockquote>
                    <Button variant="ghost" size="sm" onClick={() => focusPassage(thread.id)}><Highlighter /> Voir le passage</Button>
                    {missingPassage === thread.id && <p role="status" className="text-sm text-muted-foreground">Passage introuvable dans l’affichage actuel.</p>}
                  </div>
                )}
              </CardHeader>}
              <CardContent className="space-y-2 p-3 text-sm">
                {thread.messages.map((message, index) => (
                  <div key={index} className="whitespace-pre-wrap break-words"><span className="font-medium">{message.author === 'lawyer' ? 'Vous' : 'Assistant'}</span> {message.text}</div>
                ))}
                {reply?.id === thread.id ? (
                  <form className="flex flex-wrap gap-2" onSubmit={(event) => {
                    event.preventDefault();
                    if (reply.text.trim()) void save(() => artifactsApi.comment(project, id, { text: reply.text, thread_id: thread.id }), () => setReply(null));
                  }}>
                    <Input aria-label="Réponse" value={reply.text} onChange={(event) => setReply({ id: thread.id, text: event.target.value })} />
                    <Button size="sm" disabled={saving || !reply.text.trim()}>Envoyer</Button>
                    <Button size="sm" type="button" variant="ghost" disabled={saving} onClick={() => setReply(null)}>Annuler</Button>
                  </form>
                ) : !thread.resolved && <Button size="sm" variant="ghost" disabled={saving} onClick={() => setReply({ id: thread.id, text: '' })}>Répondre</Button>}
              </CardContent>
            </Card>
          );
        })}
        <div className="space-y-2 border-t pt-3">
          <label className="block text-sm font-medium" htmlFor="artifact-feedback">Remarques sur la décision</label>
          <textarea id="artifact-feedback" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" rows={2} maxLength={16000} value={feedback} onChange={(event) => setFeedback(event.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={saving} onClick={() => void decide('approved')}><Check /> Approuver la version</Button>
            <Button size="sm" variant="outline" disabled={saving || !feedback.trim()} onClick={() => void decide('changes_requested')}><RotateCcw /> Demander des modifications</Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
