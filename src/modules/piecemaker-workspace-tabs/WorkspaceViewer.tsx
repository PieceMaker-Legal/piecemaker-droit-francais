import { useContext, useEffect } from 'react';
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
  useEffect(() => {
    register?.(open);
    return () => register?.(false);
  }, [register, open]);

  if (!viewer) return <EditorSidebar {...props} />;
  if (!props.editingFile || !viewer.target) return null;
  return createPortal(<Card className="piecemaker-workspace-panel" style={{ flexGrow: 1 }}>
    <TabbedCodeEditor
      file={props.editingFile}
      projectPath={props.projectPath}
      onClose={props.onCloseEditor}
      isSidebar
      isExpanded={viewer.expanded}
      onToggleExpand={viewer.toggleExpand}
    />
  </Card>, viewer.target);
}
