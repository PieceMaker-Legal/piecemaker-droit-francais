import { MousePointerClick } from 'lucide-react';
import { useEffect, useState } from 'react';

const PANEL_PICK_EVENT = 'piecemaker:panel-pick';
const PANEL_PICK_STATE_EVENT = 'piecemaker:panel-pick-state';
const PICKABLE_TABS: readonly string[] = ['plugin:piecemaker-catala'];

export function PanelPickButton({ tab }: { tab: string }) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: string; active?: boolean }>).detail;
      if (detail?.tab === tab) setActive(Boolean(detail.active));
    };
    window.addEventListener(PANEL_PICK_STATE_EVENT, sync);
    return () => window.removeEventListener(PANEL_PICK_STATE_EVENT, sync);
  }, [tab]);

  if (!PICKABLE_TABS.includes(tab)) return null;
  const label = 'Cibler une carte pour le chat';
  return (
    <button type="button" aria-pressed={active} aria-label={label} title={label} onClick={() => window.dispatchEvent(new CustomEvent(PANEL_PICK_EVENT, { detail: { tab } }))}>
      <MousePointerClick />
    </button>
  );
}
