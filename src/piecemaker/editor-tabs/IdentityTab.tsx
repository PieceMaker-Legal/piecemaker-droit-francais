import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { IdentityMode } from '@/piecemaker/editor-tabs/editorPanels';

const MODE_EVENTS: Record<IdentityMode, string> = { open: 'piecemaker:identity-open', add: 'piecemaker:identity-add' };
const CLOSE_EVENT = 'piecemaker:identity-close';

export function IdentityTab({ mode, text, onClose }: { mode: IdentityMode; text: string; onClose: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const [unavailable, setUnavailable] = useState(false);

  useLayoutEffect(() => { close.current = onClose; });

  useEffect(() => {
    const target = container.current;
    if (!target) return undefined;
    window.dispatchEvent(new CustomEvent(MODE_EVENTS[mode], { detail: { text, container: target, onClose: () => close.current() } }));
    setUnavailable(!target.firstChild);
    return () => { window.dispatchEvent(new Event(CLOSE_EVENT)); };
  }, [mode, text]);

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      {unavailable && <p role="status" className="p-4 text-sm text-muted-foreground">La fiche de pseudonymisation est indisponible : activez le plugin Dossier.</p>}
      <div ref={container} className="min-h-0 flex-1" />
    </div>
  );
}
