import { MousePointerClick } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useCloseWorkspacePanel } from '@/modules/piecemaker-workspace-tabs/context/WorkspacePanelsContext';
import { usePanelNewChat } from '@/piecemaker/chat/usePanelNewChat';
import type { AppTab } from '@/shared/types';

const PANEL_PICK_EVENT = 'piecemaker:panel-pick';
const PANEL_PICK_STATE_EVENT = 'piecemaker:panel-pick-state';
const PANEL_PICKED_EVENT = 'piecemaker:panel-picked';
const PICKABLE_TABS: readonly string[] = ['plugin:piecemaker-catala', 'plugin:piecemaker-dossier'];

export function PanelPickButton({ tab, closeOnPick = false }: { tab: AppTab; closeOnPick?: boolean }) {
  const [active, setActive] = useState(false);
  const close = useCloseWorkspacePanel();
  usePanelNewChat(tab);

  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: string; active?: boolean }>).detail;
      if (detail?.tab === tab) setActive(Boolean(detail.active));
    };
    window.addEventListener(PANEL_PICK_STATE_EVENT, sync);
    return () => window.removeEventListener(PANEL_PICK_STATE_EVENT, sync);
  }, [tab]);

  useEffect(() => {
    if (!closeOnPick || !close) return;
    const leave = (event: Event) => {
      if ((event as CustomEvent<{ tab?: string }>).detail?.tab === tab) close(tab);
    };
    window.addEventListener(PANEL_PICKED_EVENT, leave);
    return () => window.removeEventListener(PANEL_PICKED_EVENT, leave);
  }, [tab, closeOnPick, close]);

  if (!PICKABLE_TABS.includes(tab)) return null;
  const label = 'Cibler un élément pour le chat';
  return (
    <button type="button" aria-pressed={active} aria-label={label} title={label} onClick={() => window.dispatchEvent(new CustomEvent(PANEL_PICK_EVENT, { detail: { tab } }))}>
      <MousePointerClick />
    </button>
  );
}
