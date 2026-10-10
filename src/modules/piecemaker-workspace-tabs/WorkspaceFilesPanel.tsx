import { EllipsisVertical, List, Maximize2, Minimize2, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { FileTree } from '@/modules/file-tree';
import { openInEditor } from '@/piecemaker/editor-tabs/editorPanels';
import type { Project } from '@/shared/types';
import { Card, Tooltip } from '@/shared/ui';

export type WorkspaceFilesSlots = { viewer: HTMLElement; tabs: HTMLElement };

type WorkspaceFilesPanelProps = {
  label: string;
  selectedProject: Project | null;
  documentOpen: boolean;
  expanded: boolean;
  hidden: boolean;
  style: CSSProperties;
  onSlots: (slots: WorkspaceFilesSlots | null) => void;
  onToggleExpand: () => void;
  onClose: () => void;
};

export function WorkspaceFilesPanel({ label, selectedProject, documentOpen, expanded, hidden, style, onSlots, onToggleExpand, onClose }: WorkspaceFilesPanelProps) {
  const [treeVisible, setTreeVisible] = useState(true);
  const [toolsVisible, setToolsVisible] = useState(false);
  const [viewer, setViewer] = useState<HTMLElement | null>(null);
  const [tabs, setTabs] = useState<HTMLElement | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const showTree = treeVisible || !documentOpen;
  const treeToggleLabel = showTree ? 'Masquer l’arborescence de fichiers' : 'Afficher l’arborescence de fichiers';

  useEffect(() => {
    onSlots(viewer && tabs ? { viewer, tabs } : null);
    return () => onSlots(null);
  }, [viewer, tabs, onSlots]);

  useEffect(() => {
    if (hidden || !documentOpen) return undefined;
    const toggleTree = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== 'y') return;
      event.preventDefault();
      setTreeVisible((current) => !current);
    };
    document.addEventListener('keydown', toggleTree);
    return () => document.removeEventListener('keydown', toggleTree);
  }, [hidden, documentOpen]);

  const focusFilter = () => {
    setTreeVisible(true);
    requestAnimationFrame(() => treeRef.current?.querySelector<HTMLInputElement>('input[type="text"]')?.focus());
  };

  return (
    <Card className="piecemaker-workspace-panel piecemaker-files-panel" hidden={hidden} style={style}>
      <header className="piecemaker-workspace-panel-header">
        <Tooltip position="bottom" content={<span className="flex items-center gap-3">{treeToggleLabel}<kbd className="opacity-60">⇧⌘Y</kbd></span>}>
          <button type="button" aria-label={treeToggleLabel} aria-keyshortcuts="Shift+Meta+Y" aria-pressed={showTree} disabled={!documentOpen} onClick={() => setTreeVisible(!showTree)}><List /></button>
        </Tooltip>
        <div ref={setTabs} className="piecemaker-files-tabs-slot" />
        {!documentOpen && <span className="truncate text-sm font-medium">{label}</span>}
        <button type="button" aria-label="Filtrer les fichiers" onClick={focusFilter}><Search /></button>
        <button type="button" aria-label="Actions sur les fichiers" aria-pressed={toolsVisible} onClick={() => setToolsVisible(!toolsVisible)}><EllipsisVertical /></button>
        <button type="button" aria-label={`${expanded ? 'Réduire' : 'Agrandir'} ${label}`} onClick={onToggleExpand}>{expanded ? <Minimize2 /> : <Maximize2 />}</button>
        <button type="button" aria-label={`Fermer ${label}`} onClick={onClose}><X /></button>
      </header>
      <div className="piecemaker-files-body" data-document-open={documentOpen}>
        <div ref={treeRef} className="piecemaker-files-tree" data-tools-visible={toolsVisible} hidden={!showTree}>
          <FileTree selectedProject={selectedProject} onFileOpen={openInEditor} />
        </div>
        <div ref={setViewer} className="piecemaker-files-viewer" hidden={!documentOpen} />
      </div>
    </Card>
  );
}
