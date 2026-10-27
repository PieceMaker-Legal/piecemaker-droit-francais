import { useEffect, useMemo, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import CodeEditor from '@/modules/code-editor/CodeEditor';
import { setActiveDocument } from '@/modules/piecemaker-context-suggestions';
import { resolveFileRef } from '@/piecemaker/chat/fileRef';
import { CitationPanel } from '@/piecemaker/citations/CitationPanel';
import { FileDocumentEditor } from '@/piecemaker/editor-tabs/FileDocumentEditor';
import { IdentityTab } from '@/piecemaker/editor-tabs/IdentityTab';
import { PlanTab } from '@/piecemaker/editor-tabs/PlanTab';
import { CLOSE_IN_EDITOR_EVENT, parseEditorPanel } from '@/piecemaker/editor-tabs/editorPanels';
import type { CodeEditorFile } from '@/shared/types';

type CodeEditorProps = ComponentProps<typeof CodeEditor> & { tabsTarget?: HTMLElement | null };

const LIBRARY_PROJECT_PREFIX = 'piecemaker-library:';

const tabKey =(file: CodeEditorFile) => `${file.projectId ?? ''}\u0000${file.path}`;

function sameEditorPath(left: string, right: string) {
  const a = left.replace(/\\/g, '/');
  const b = right.replace(/\\/g, '/');
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function tabLabel(file: CodeEditorFile) {
  const panel = parseEditorPanel(file.path);
  if (panel?.kind === 'citation') return panel.label || 'Citation';
  if (panel?.kind === 'identity') return panel.text;
  if (panel?.kind === 'plan') return 'Plan';
  return file.name;
}

/**
 * Vérifie le fichier avant de monter `CodeEditor`, qui afficherait sinon une
 * erreur de lecture : le chemin est remplacé par son chemin réel, et un
 * fichier disparu est signalé sans ouvrir d'éditeur.
 */
function ResolvedCodeEditor({ props, file, onClose }: { props: CodeEditorProps; file: CodeEditorFile; onClose: () => void }) {
  const [resolved, setResolved] = useState<{ ref: string; path: string | null } | null>(null);

  useEffect(() => {
    let live = true;
    if (file.projectId?.startsWith(LIBRARY_PROJECT_PREFIX)) {
      setResolved({ ref: file.path, path: file.path });
      return () => { live = false; };
    }
    void resolveFileRef(file.path, { fresh: true, projectId: file.projectId }).then((path) => {
      if (live) setResolved({ ref: file.path, path });
    });
    return () => { live = false; };
  }, [file.path, file.projectId]);

  const path = resolved?.ref === file.path ? resolved.path : undefined;
  const resolvedFile = useMemo(() => (path ? { ...file, path } : null), [file, path]);

  if (path === undefined) return null;
  if (!resolvedFile) {
    const missing = (
      <div role="status" className="flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-center text-sm text-muted-foreground">
        <p>Ce fichier n’existe plus : {file.name}</p>
        <button type="button" className="rounded border border-border px-3 py-1 text-xs hover:bg-accent" onClick={onClose}>Fermer</button>
      </div>
    );
    return props.isSidebar ? missing : <div className="fixed inset-0 z-[9999]">{missing}</div>;
  }
  const { tabsTarget, ...editorProps } = props;
  const Editor = tabsTarget ? FileDocumentEditor : CodeEditor;
  return <Editor {...editorProps} file={resolvedFile} onClose={onClose} />;
}

function TabContent({ props, file, onClose }: { props: CodeEditorProps; file: CodeEditorFile; onClose: () => void }) {
  const panel = parseEditorPanel(file.path);
  if (!panel) return <ResolvedCodeEditor props={props} file={file} onClose={onClose} />;
  const content = panel.kind === 'citation'
    ? <CitationPanel token={panel.token} onClose={onClose} />
    : panel.kind === 'plan'
      ? <PlanTab id={panel.id} />
      : <IdentityTab mode={panel.mode} text={panel.text} onClose={onClose} />;
  return props.isSidebar ? content : <div className="fixed inset-0 z-[9999] bg-background">{content}</div>;
}

export default function TabbedCodeEditor(props: CodeEditorProps) {
  const { file, onClose, isSidebar, tabsTarget } = props;
  const [openedFile, setOpenedFile] = useState(file);
  const [tabs, setTabs] = useState<CodeEditorFile[]>([file]);
  const [activeKey, setActiveKey] = useState(tabKey(file));

  if (openedFile !== file) {
    setOpenedFile(file);
    setTabs((current) => current.some((tab) => tabKey(tab) === tabKey(file))
      ? current.map((tab) => tabKey(tab) === tabKey(file) ? file : tab)
      : [...current, file]);
    setActiveKey(tabKey(file));
  }

  const active = tabs.find((tab) => tabKey(tab) === activeKey) ?? tabs[tabs.length - 1];
  const activeDocument = isSidebar && !parseEditorPanel(active.path) ? active.path : null;

  useEffect(() => {
    setActiveDocument(activeDocument);
    return () => setActiveDocument(null);
  }, [activeDocument]);

  const closeTab = (key: string) => {
    const index = tabs.findIndex((tab) => tabKey(tab) === key);
    const remaining = tabs.filter((tab) => tabKey(tab) !== key);
    if (!remaining.length) {
      onClose();
      return;
    }
    setTabs(remaining);
    if (key === tabKey(active)) setActiveKey(tabKey(remaining[Math.max(0, index - 1)]));
  };

  useEffect(() => {
    const closeRequested = (event: Event) => {
      const path = (event as CustomEvent<{ path?: unknown }>).detail?.path;
      if (typeof path !== 'string' || !path) return;
      const match = tabs.find((tab) => sameEditorPath(tab.path, path) || tab.name === path.split(/[\\/]/).pop());
      if (match) closeTab(tabKey(match));
    };
    window.addEventListener(CLOSE_IN_EDITOR_EVENT, closeRequested);
    return () => window.removeEventListener(CLOSE_IN_EDITOR_EVENT, closeRequested);
  });

  const content: ReactNode = <TabContent key={tabKey(active)} props={props} file={active} onClose={() => closeTab(tabKey(active))} />;
  if (tabsTarget) {
    return (
      <>
        {isSidebar && createPortal(<div role="tablist" aria-label="Documents ouverts" className="piecemaker-files-tabs">
          {tabs.map((tab) => {
            const key = tabKey(tab);
            const selected = key === tabKey(active);
            const label = tabLabel(tab);
            return (
              <div key={key} className="piecemaker-files-tab" data-selected={selected}>
                <button type="button" role="tab" aria-selected={selected} title={label} onClick={() => setActiveKey(key)} onAuxClick={(event) => { if (event.button === 1) closeTab(key); }}>
                  {label}
                </button>
                <button type="button" aria-label={`Fermer ${label}`} onClick={() => closeTab(key)}>
                  <X />
                </button>
              </div>
            );
          })}
        </div>, tabsTarget)}
        {content}
      </>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      {isSidebar && tabs.length > 1 && <div role="tablist" aria-label="Documents ouverts" className="flex shrink-0 overflow-x-auto border-b border-border bg-muted/40">
        {tabs.map((tab) => {
          const key = tabKey(tab);
          const selected = key === tabKey(active);
          const label = tabLabel(tab);
          return (
            <div key={key} className={`group flex max-w-56 shrink-0 items-center border-r border-border ${selected ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-background/60'}`}>
              <button type="button" role="tab" aria-selected={selected} title={label} className="min-w-0 truncate py-1.5 pl-3 pr-1 text-xs" onClick={() => setActiveKey(key)} onAuxClick={(event) => { if (event.button === 1) closeTab(key); }}>
                {label}
              </button>
              <button type="button" aria-label={`Fermer ${label}`} className="mr-1 rounded p-0.5 opacity-60 hover:bg-accent hover:opacity-100" onClick={() => closeTab(key)}>
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>}
      <div className="min-h-0 flex-1">{content}</div>
    </div>
  );
}
