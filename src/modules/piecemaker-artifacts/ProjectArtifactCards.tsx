import { FileText } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useArtifactResource } from '@/modules/piecemaker-artifacts/hooks/useArtifactResource';
import { api, artifactsApi } from '@/shared/api';

type ProjectArtifactCardsProps = {
  project: string;
  projectId: string;
  artifacts: { url: string; title: string; updated_at?: string }[];
  onOpen: (url: string) => void;
};

function Preview({ project, projectId, id }: { project: string; projectId: string; id: string }) {
  const load = useCallback(async () => {
    const artifact = await artifactsApi.detail(project, id);
    if (artifact.format !== 'docx') return artifactsApi.frame(project, id, artifact.version);
    if (!artifact.document_path) return null;
    const [response, { parseDocx }, { toProseDoc }] = await Promise.all([
      api.readFileBlob(projectId, artifact.document_path),
      import('@eigenpal/docx-editor-core'),
      import('@eigenpal/docx-editor-core/prosemirror/conversion'),
    ]);
    if (!response.ok) return null;
    const doc = await parseDocx(await response.arrayBuffer());
    const content = toProseDoc(doc);
    return { text: content.textBetween(0, Math.min(420, content.content.size), '\n', ' ').trim() };
  }, [id, project, projectId]);
  const { value } = useArtifactResource(load);

  if (value && 'src' in value) return <iframe title="Aperçu" tabIndex={-1} sandbox="" referrerPolicy="no-referrer"
    src={value.src} className="pointer-events-none h-[288px] w-[512px] shrink-0 origin-top-left scale-[.30] border-0 bg-white" />;
  if (value?.text) return <p className="m-2 whitespace-pre-line rounded-t bg-background p-2 text-[10px] leading-tight text-foreground">{value.text}</p>;
  return <FileText aria-hidden="true" className="m-auto size-6 text-muted-foreground" />;
}

function ArtifactCard({ project, projectId, url, title, updatedAt, onOpen }: {
  project: string; projectId: string; url: string; title: string; updatedAt?: string; onOpen: (url: string) => void;
}) {
  const card = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  const id = /^piecemaker:\/\/artifact\/([a-z][a-z0-9-]{2,63})$/.exec(url)?.[1];

  useEffect(() => {
    if (seen || !card.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setSeen(true);
    });
    observer.observe(card.current);
    return () => observer.disconnect();
  }, [seen]);

  if (!id) return null;
  return <article ref={card} className="relative w-40 shrink-0 overflow-hidden rounded-xl border border-border bg-card focus-within:border-ring hover:border-ring">
    <button type="button" aria-label={title} title={title} onClick={() => onOpen(url)} className="absolute inset-0 z-10 rounded-xl focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" />
    <div aria-hidden="true" className="flex h-[86px] overflow-hidden bg-primary/15">
      {seen && <Preview key={updatedAt} project={project} projectId={projectId} id={id} />}
    </div>
    <span className="block truncate border-t border-border px-2.5 py-1.5 text-sm">{title}</span>
  </article>;
}

export function ProjectArtifactCards({ project, projectId, artifacts, onOpen }: ProjectArtifactCardsProps) {
  if (!artifacts.length) return null;
  return <section aria-label="Artéfacts" className="min-w-0 px-3 pt-3">
    <h2 className="px-2 text-sm font-medium text-muted-foreground">Artéfacts</h2>
    <div className="scrollbar-hide flex gap-3 overflow-x-auto px-2 py-2">
      {artifacts.map(({ url, title, updated_at }) => (
        <ArtifactCard key={url} project={project} projectId={projectId} url={url} title={title} updatedAt={updated_at} onOpen={onOpen} />
      ))}
    </div>
  </section>;
}
