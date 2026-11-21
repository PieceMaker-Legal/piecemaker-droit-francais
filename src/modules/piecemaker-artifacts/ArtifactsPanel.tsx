import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import {
  ArrowLeft, Highlighter, Link, Pencil, Pin, PinOff,
} from 'lucide-react';

import { ArtifactFrame } from '@/modules/piecemaker-artifacts/ArtifactFrame';
import { ArtifactReview } from '@/modules/piecemaker-artifacts/ArtifactReview';
import { ArtifactState } from '@/modules/piecemaker-artifacts/ArtifactState';
import { useArtifactResource } from '@/modules/piecemaker-artifacts/hooks/useArtifactResource';
import { DocxDocumentViewer } from '@/piecemaker/docx';
import { artifactsApi } from '@/shared/api';
import { Badge, Button } from '@/shared/ui';
import type { ArtifactDetail, ArtifactPassage, ArtifactSummary, CodeEditorFile } from '@/shared/types';

const TabbedCodeEditor = lazy(() => import('@/piecemaker/editor-tabs/TabbedCodeEditor'));

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

type Target = { id: string; version: number | null; reviewing: boolean };

function formatDate(date: string) {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? '' : dateFormat.format(parsed);
}

function PinButton({ item, disabled, onClick }: { item: ArtifactSummary; disabled: boolean; onClick: () => void }) {
  const label = item.pinned ? 'Désépingler' : 'Épingler';
  return (
    <Button type="button" size="icon" variant="ghost" title={label} aria-label={label} aria-pressed={item.pinned} disabled={disabled} onClick={onClick}>
      {item.pinned ? <PinOff /> : <Pin />}
    </Button>
  );
}

function ReviewedPage({ project, detail, version, reviewing }: {
  project: string;
  detail: ArtifactDetail;
  version: number;
  reviewing: boolean;
}) {
  const [selection, setSelection] = useState<ArtifactPassage | null>(null);
  const [selectionReset, setSelectionReset] = useState(0);
  const [focusedPassage, setFocusedPassage] = useState<{ id: string } | null>(null);
  const [missingPassage, setMissingPassage] = useState<string | null>(null);
  const loadThreads = useCallback(() => artifactsApi.threads(project, detail.id), [detail.id, project]);
  const resource = useArtifactResource(loadThreads, true);
  const threads = useMemo(() => resource.value?.filter(({ anchor }) => !anchor?.version || anchor.version === version), [resource.value, version]);
  const highlights = useMemo(() => threads?.flatMap(({ id, anchor }) => anchor?.passage ? [{ id, passage: anchor.passage }] : []) ?? [], [threads]);
  const onSelection = useCallback((passage: ArtifactPassage) => setSelection(passage), []);
  const onPassageStatus = useCallback(({ id, found }: { id: string; found: boolean }) => setMissingPassage(found ? null : id), []);

  const clearSelection = () => {
    setSelection(null);
    setSelectionReset((current) => current + 1);
  };

  return (
    <>
      <ArtifactFrame project={project} artifact={detail} version={version} dataStamp={detail.data_stamp}
        reviewing={reviewing} highlights={highlights} selectionReset={selectionReset} focusedPassage={focusedPassage}
        onSelection={onSelection} onPassageStatus={onPassageStatus} />
      {reviewing && <ArtifactReview project={project} id={detail.id} version={version} selection={selection}
        clearSelection={clearSelection} threads={threads} error={resource.error} refresh={resource.refresh}
        missingPassage={missingPassage} focusPassage={(id) => { setMissingPassage(null); setFocusedPassage({ id }); }} />}
    </>
  );
}

function Viewer({ project, projectId, target, change, back, onDirty }: {
  projectId: string;
  onDirty?: (dirty: boolean) => void;
  project: string;
  target: Target;
  change: (target: Target) => void;
  back: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const [copied, setCopied] = useState(false);
  const [editingFile, setEditingFile] = useState<CodeEditorFile | null>(null);
  const [sourceVersion, setSourceVersion] = useState<number | null>(null);
  const load = useCallback(() => artifactsApi.detail(project, target.id), [project, target.id]);
  const { value: detail, error, refresh } = useArtifactResource(load, true);
  const version = target.version ?? detail?.version;

  const act = async (run: () => Promise<unknown>) => {
    setSaving(true);
    setActionError('');
    try {
      await run();
    } catch (failure) {
      setActionError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (editingFile) {
    return <Suspense fallback={<ArtifactState />}>
      <TabbedCodeEditor file={editingFile} isSidebar projectPath={project}
        onUnsavedChangesChange={onDirty} onClose={() => { onDirty?.(false); setEditingFile(null); }} />
    </Suspense>;
  }
  if (detail?.format === 'docx' && detail.document_path && projectId) {
    const path = detail.document_path;
    return <DocxDocumentViewer file={{ path, name: path.split(/[\\/]/).at(-1)! }} projectId={projectId} isSidebar onClose={back} />;
  }

  const backLabel = 'Retour au projet';
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex flex-wrap items-center gap-2 border-b p-2">
        <Button type="button" variant="ghost" size="icon" title={backLabel} aria-label={backLabel} onClick={back}><ArrowLeft /></Button>
        {detail && <>
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium" title={detail.title}>{detail.title}</h2>
          {detail.format !== 'docx' && <>
            <select
              aria-label="Version"
              className="max-w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={version}
              onChange={(event) => change({ ...target, version: Number(event.target.value) })}
            >
              {detail.versions.map((entry) => (
                <option key={entry.version} value={entry.version}>v{entry.version}{entry.label ? ` · ${entry.label}` : ''} · {formatDate(entry.published_at)}</option>
              ))}
            </select>
            {version !== detail.version && <Button size="sm" variant="ghost" onClick={() => change({ ...target, version: target.reviewing ? detail.version : null })}>Dernière version</Button>}
            {version === detail.version && <Button size="sm" variant="outline" disabled={saving}
              onClick={() => void act(async () => {
                const source = await artifactsApi.editableSource(project, detail.id, version);
                setSourceVersion(version);
                setEditingFile({ path: source.path, name: source.path.split(/[\\/]/).at(-1)!, projectId });
              })}><Pencil /> Modifier le HTML</Button>}
            {sourceVersion !== null && <Button size="sm" variant="outline" disabled={saving}
              onClick={() => void act(async () => {
                await artifactsApi.updateFromSource(project, detail.id, sourceVersion);
                setSourceVersion(null);
                change({ id: detail.id, version: null, reviewing: false });
                await refresh();
              })}>Actualiser depuis le fichier</Button>}
            <Button variant={target.reviewing ? 'secondary' : 'outline'} size="sm" aria-pressed={target.reviewing}
              onClick={() => change({ ...target, version: version ?? null, reviewing: !target.reviewing })}><Highlighter /> Revue</Button>
          </>}
          <PinButton item={detail} disabled={saving} onClick={() => void act(async () => { await artifactsApi.pin(project, detail.id, !detail.pinned); await refresh(); })} />
          <Button variant="ghost" size="icon" aria-label="Copier le lien" title="Copier le lien"
            onClick={() => void act(async () => { await navigator.clipboard.writeText(detail.url); setCopied(true); })}><Link /></Button>
          {copied && <Badge role="status" variant="secondary">Lien copié</Badge>}
        </>}
      </header>
      {error && <ArtifactState error={error} retry={() => void refresh()} />}
      {actionError && <ArtifactState error={actionError} />}
      {!detail && !error && <ArtifactState />}
      {detail?.format === 'docx' && <ArtifactState empty="Le fichier Word est introuvable dans ce dossier." />}
      {detail && detail.format !== 'docx' && version !== undefined && <ReviewedPage key={version} project={project} detail={detail} version={version} reviewing={target.reviewing} />}
    </div>
  );
}

export function ProjectArtifact({ project, projectId, id, onClose, onDirty }: {
  project: string;
  projectId: string;
  id: string;
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [target, setTarget] = useState<Target>({ id, version: null, reviewing: false });
  return <Viewer project={project} projectId={projectId} target={target} change={setTarget} back={onClose} onDirty={onDirty} />;
}
