import { useEffect } from 'react';

import { setCitationPassage } from '@/piecemaker/citations/citationPassage';
import { OPEN_IN_EDITOR_EVENT } from '@/piecemaker/editor-tabs/editorPanels';

export function usePiecemakerEditorBridge(openFile: (path: string) => unknown) {
  useEffect(() => {
    const open = (event: Event) => {
      const { path, passage } = (event as CustomEvent<{ path?: unknown; passage?: { quote?: unknown } }>).detail ?? {};
      if (typeof path !== 'string' || !path) return;
      if (typeof passage?.quote === 'string' && passage.quote) setCitationPassage(path, passage.quote);
      openFile(path);
    };
    window.addEventListener(OPEN_IN_EDITOR_EVENT, open);
    return () => window.removeEventListener(OPEN_IN_EDITOR_EVENT, open);
  }, [openFile]);
}
