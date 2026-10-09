import { useEffect } from 'react';

import { OPEN_IN_EDITOR_EVENT } from '@/piecemaker/editor-tabs/editorPanels';

export function usePiecemakerEditorBridge(openFile: (path: string) => unknown) {
  useEffect(() => {
    const open = (event: Event) => {
      const path = (event as CustomEvent<{ path?: unknown }>).detail?.path;
      if (typeof path === 'string' && path) openFile(path);
    };
    window.addEventListener(OPEN_IN_EDITOR_EVENT, open);
    return () => window.removeEventListener(OPEN_IN_EDITOR_EVENT, open);
  }, [openFile]);
}
