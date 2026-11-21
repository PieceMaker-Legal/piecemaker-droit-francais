import { useCallback, useEffect, useRef, useState } from 'react';

import { ArtifactState } from '@/modules/piecemaker-artifacts/ArtifactState';
import { useArtifactResource } from '@/modules/piecemaker-artifacts/hooks/useArtifactResource';
import { artifactsApi } from '@/shared/api';
import { useTheme } from '@/shared/context/ThemeContext';
import type { ArtifactPassage, ArtifactSummary } from '@/shared/types';

type FrameProps = {
  project: string;
  artifact: ArtifactSummary;
  version: number;
  dataStamp: number;
  reviewing: boolean;
  highlights: { id: string; passage: ArtifactPassage }[];
  selectionReset: number;
  focusedPassage: { id: string } | null;
  onSelection: (selection: ArtifactPassage) => void;
  onPassageStatus: (status: { id: string; found: boolean }) => void;
};

export function ArtifactFrame({
  project, artifact, version, dataStamp, reviewing, highlights, selectionReset, focusedPassage, onSelection, onPassageStatus,
}: FrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const { isDarkMode } = useTheme();
  const [ready, setReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const lastData = useRef(dataStamp);
  const load = useCallback(() => artifactsApi.frame(project, artifact.id, version), [project, artifact.id, version]);
  const { value, error, refresh } = useArtifactResource(load);

  const post = useCallback((message: object) => {
    frame.current?.contentWindow?.postMessage({ channel: 'piecemaker-artifact', ...message }, '*');
  }, []);

  useEffect(() => {
    let active = true;
    const receive = async (event: MessageEvent) => {
      const source = frame.current?.contentWindow;
      if (!source || event.source !== source || event.data?.channel !== 'piecemaker-artifact') return;
      const { id, op, args } = event.data;
      if (op === 'ready') { setReady(true); setTimedOut(false); return; }
      if (op === 'selection') {
        if (typeof args?.quote === 'string' && args.quote.trim() && args.quote.length <= 4000
          && Number.isSafeInteger(args.start) && args.start >= 0
          && typeof args.before === 'string' && args.before.length <= 48
          && typeof args.after === 'string' && args.after.length <= 48) {
          onSelection({ quote: args.quote, start: args.start, before: args.before, after: args.after });
        }
        return;
      }
      if (op === 'passage-status') {
        if (typeof args?.id === 'string' && typeof args.found === 'boolean') onPassageStatus({ id: args.id, found: args.found });
        return;
      }
      if (typeof op !== 'string' || typeof id !== 'string') return;
      const reply = (payload: object) => {
        if (active && frame.current?.contentWindow === source) post({ id, ...payload });
      };
      try {
        if (op === 'download') {
          const { name, content, type } = args;
          const url = URL.createObjectURL(new Blob([content], { type }));
          Object.assign(document.createElement('a'), { href: url, download: name }).click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          reply({ result: { saved: name } });
        } else {
          const result = await artifactsApi.data(project, artifact.id, op, args);
          if (!['get', 'list', 'query'].includes(op)) lastData.current = Math.max(lastData.current, Date.now());
          reply({ result });
        }
      } catch (failure) {
        reply({ error: { message: (failure as Error).message, code: (failure as Error & { code?: string }).code } });
      }
    };
    window.addEventListener('message', receive);
    return () => {
      active = false;
      window.removeEventListener('message', receive);
    };
  }, [artifact.id, onPassageStatus, onSelection, post, project]);

  useEffect(() => {
    if (!value?.src || ready) return;
    const timer = window.setTimeout(() => setTimedOut(true), 12000);
    return () => window.clearTimeout(timer);
  }, [ready, value?.src]);

  useEffect(() => {
    if (ready) post({ kind: 'theme', theme: isDarkMode ? 'dark' : 'light' });
  }, [isDarkMode, post, ready]);

  useEffect(() => {
    if (ready) post({ kind: 'review', enabled: reviewing, highlights });
  }, [highlights, post, ready, reviewing]);

  useEffect(() => {
    if (ready && selectionReset) post({ kind: 'clear-selection' });
  }, [post, ready, selectionReset]);

  useEffect(() => {
    if (ready && dataStamp > lastData.current) {
      lastData.current = dataStamp;
      post({ kind: 'data' });
    }
  }, [dataStamp, post, ready]);

  useEffect(() => {
    if (ready && focusedPassage) post({ kind: 'focus-passage', id: focusedPassage.id });
  }, [focusedPassage, post, ready]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {!ready && <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background">
        <ArtifactState error={error || (timedOut ? 'La page ne répond pas.' : '')} retry={() => { setTimedOut(false); void refresh(); }} />
      </div>}
      {value && <iframe
        key={value.src}
        ref={frame}
        src={value.src}
        title={artifact.title}
        sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads"
        referrerPolicy="no-referrer"
        className="size-full flex-1 border-0"
      />}
    </div>
  );
}
