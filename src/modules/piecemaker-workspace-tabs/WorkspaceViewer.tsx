import { useContext, useEffect, useRef } from 'react';
import type { ComponentProps } from 'react';
import { createPortal } from 'react-dom';

import { EditorSidebar } from '@/modules/code-editor';
import { WorkspaceViewerContext } from '@/modules/piecemaker-workspace-tabs/context/WorkspaceViewerContext';
import TabbedCodeEditor from '@/piecemaker/editor-tabs/TabbedCodeEditor';
import { Card } from '@/shared/ui';

export function WorkspaceViewer(props: ComponentProps<typeof EditorSidebar>) {
  const viewer = useContext(WorkspaceViewerContext);
  const register = viewer?.register;
  const open = Boolean(props.editingFile);
  const registerRef = useRef(register);
  registerRef.current = register;
  useEffect(() => {
    register?.(open);
  }, [register, open]);
  useEffect(() => () => registerRef.current?.(false), []);

  if (!viewer) return <EditorSidebar {...props} />;
  if (!props.editingFile || !viewer.target) return null;
  const editor = <TabbedCodeEditor
    file={props.editingFile}
    projectPath={props.projectPath}
    onClose={props.onCloseEditor}
    onUnsavedChangesChange={props.onUnsavedChangesChange}
    isSidebar
    isExpanded={viewer.expanded}
    onToggleExpand={viewer.toggleExpand}
    tabsTarget={viewer.tabsTarget}
  />;
  return createPortal(viewer.tabsTarget ? editor : <Card className="piecemaker-workspace-panel" style={{ flexGrow: 1 }}>{editor}</Card>, viewer.target);
}
