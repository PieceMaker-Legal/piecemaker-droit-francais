import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, BarChart3, Calendar, CheckSquare, Code2, FileText, Highlighter, Link, List, Map, Pin, PinOff,
  Presentation, Table, Trash2,
} from 'lucide-react';

import { ArtifactFrame } from '@/modules/piecemaker-artifacts/ArtifactFrame';
import { ArtifactReview } from '@/modules/piecemaker-artifacts/ArtifactReview';
import { ArtifactState } from '@/modules/piecemaker-artifacts/ArtifactState';
import { ARTIFACTS_TAB, ARTIFACTS_SHOW_EVENT, ARTIFACTS_SHOW_KEY } from '@/modules/piecemaker-artifacts/openArtifactInPanel';
import { useArtifactResource } from '@/modules/piecemaker-artifacts/hooks/useArtifactResource';
import { artifactsApi } from '@/shared/api';
import { Badge, Button, Card, Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import type { ArtifactDetail, ArtifactPassage, ArtifactSummary } from '@/shared/types';

const icons = {
  chart: BarChart3, dashboard: BarChart3, calendar: Calendar, slides: Presentation, checklist: CheckSquare,
  tracker: CheckSquare, map: Map, table: Table, code: Code2, timeline: List,
};
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

function Gallery({ project, open, pinnedOnly, setPinnedOnly }: {
  project: string;
  open: (id: string) => void;
  pinnedOnly: boolean;
  setPinnedOnly: (pinned: boolean) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => artifactsApi.list(project), [project]);
  const gallery = useArtifactResource(load, true);
  const shown = gallery.value?.filter((artifact) => !pinnedOnly || artifact.pinned);

  const pin = async (artifact: ArtifactSummary) => {
    setSaving(true);
    setError('');
    try {
      await artifactsApi.pin(project, artifact.id, !artifact.pinned);
      await gallery.refresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-auto bg-background">
      <div className="flex flex-wrap gap-2 border-b p-3">
        <Button size="sm" variant={pinnedOnly ? 'ghost' : 'secondary'} aria-pressed={!pinnedOnly} onClick={() => setPinnedOnly(false)}>Tous</Button>
        <Button size="sm" variant={pinnedOnly ? 'secondary' : 'ghost'} aria-pressed={pinnedOnly} onClick={() => setPinnedOnly(true)}><Pin /> Épinglés</Button>
      </div>
      {gallery.error && <ArtifactState error={gallery.error} retry={() => void gallery.refresh()} />}
      {error && <ArtifactState error={error} />}
      {!shown && !gallery.error && <ArtifactState />}
      {shown?.length === 0 && !gallery.error && <ArtifactState empty={pinnedOnly ? 'Aucun artifact épinglé.' : 'Aucun artifact dans ce dossier.'} />}
      {Boolean(shown?.length) && <div className="grid gap-2 p-3">
        {shown?.map((item) => {
          const Icon = item.icon && Object.prototype.hasOwnProperty.call(icons, item.icon) ? icons[item.icon as keyof typeof icons] : FileText;
          return (
            <Card key={item.id} className="flex min-w-0 items-start gap-1 p-2">
              <Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start whitespace-normal p-2 text-left" onClick={() => open(item.id)}>
                <Icon aria-hidden="true" />
                <span className="min-w-0 space-y-1 break-words">
                  <span className="block font-medium">{item.title}</span>
                  {item.description && <span className="block font-normal text-muted-foreground">{item.description}</span>}
                  <span className="block text-xs font-normal text-muted-foreground">v{item.version} · {formatDate(item.updated_at)}</span>
                </span>
              </Button>
              <PinButton item={item} disabled={saving} onClick={() => void pin(item)} />
            </Card>
          );
        })}
      </div>}
    </div>
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

function Viewer({ project, target, change, back }: {
  project: string;
  target: Target;
  change: (target: Target) => void;
  back: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const [copied, setCopied] = useState(false);
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex flex-wrap items-center gap-2 border-b p-2">
        <Button type="button" variant="ghost" size="icon" title="Retour à la galerie" aria-label="Retour à la galerie" onClick={back}><ArrowLeft /></Button>
        {detail && <>
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium" title={detail.title}>{detail.title}</h2>
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
          <PinButton item={detail} disabled={saving} onClick={() => void act(async () => { await artifactsApi.pin(project, detail.id, !detail.pinned); await refresh(); })} />
          <Button variant={target.reviewing ? 'secondary' : 'outline'} size="sm" aria-pressed={target.reviewing}
            onClick={() => change({ ...target, version: version ?? null, reviewing: !target.reviewing })}><Highlighter /> Revue</Button>
          <Button variant="ghost" size="icon" aria-label="Copier le lien" title="Copier le lien"
            onClick={() => void act(async () => { await navigator.clipboard.writeText(detail.url); setCopied(true); })}><Link /></Button>
          <Button variant="ghost" size="icon" aria-label="Supprimer" title="Supprimer" disabled={saving} onClick={() => setConfirmDelete(true)}><Trash2 /></Button>
          {copied && <Badge role="status" variant="secondary">Lien copié</Badge>}
        </>}
      </header>
      {error && <ArtifactState error={error} retry={() => void refresh()} />}
      {actionError && <ArtifactState error={actionError} />}
      {!detail && !error && <ArtifactState />}
      {detail && version !== undefined && <ReviewedPage key={version} project={project} detail={detail} version={version} reviewing={target.reviewing} />}
      {detail && <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="space-y-3">
          <DialogTitle>Supprimer « {detail.title} » ?</DialogTitle>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Annuler</Button>
            <Button variant="destructive" disabled={saving} onClick={() => void act(async () => {
              setConfirmDelete(false);
              await artifactsApi.remove(project, detail.id);
              back();
            })}>Supprimer</Button>
          </div>
        </DialogContent>
      </Dialog>}
    </div>
  );
}

function ArtifactsProject({ project }: { project: string }) {
  const [target, setTarget] = useState<Target | null>(null);
  const [pinnedOnly, setPinnedOnly] = useState(false);

  useEffect(() => {
    const takeShow = () => {
      const holder = window as unknown as Record<string, { project?: string | null; artifact?: string | null; preserveReview?: boolean } | undefined>;
      const request = holder[ARTIFACTS_SHOW_KEY];
      if (!request || (request.project && request.project !== project)) return;
      delete holder[ARTIFACTS_SHOW_KEY];
      const value = request.artifact?.replace(/^piecemaker:\/\/artifact\//, '');
      if (!value) return;
      const match = /^([a-z][a-z0-9-]{2,63})(?:@v([1-9]\d*))?$/.exec(value);
      if (!match) return;
      const [, id, version] = match;
      setTarget((current) => request.preserveReview && current?.id === id && current.reviewing
        ? current : { id, version: version ? Number(version) : null, reviewing: Boolean(version) });
    };
    window.addEventListener(ARTIFACTS_SHOW_EVENT, takeShow);
    takeShow();
    return () => window.removeEventListener(ARTIFACTS_SHOW_EVENT, takeShow);
  }, [project]);

  const file = target?.reviewing ? `${target.id}@v${target.version}` : target?.id;
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('piecemaker:panel-focus', { detail: { tab: ARTIFACTS_TAB, ...(file && { file }) } }));
  }, [file, project]);

  return target
    ? <Viewer key={target.id} project={project} target={target} change={setTarget} back={() => setTarget(null)} />
    : <Gallery project={project} pinnedOnly={pinnedOnly} setPinnedOnly={setPinnedOnly} open={(id) => setTarget({ id, version: null, reviewing: false })} />;
}

export function ArtifactsPanel({ project }: { project: string | null }) {
  return project ? <ArtifactsProject key={project} project={project} /> : <ArtifactState empty="Ouvrez un dossier." />;
}
