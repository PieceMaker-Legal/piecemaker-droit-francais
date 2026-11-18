import type { AppTab } from '@/shared/types';

export const OPEN_PANEL_EVENT = 'piecemaker:open-panel';

export function requestWorkspacePanel(tab: AppTab) {
  window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, { detail: { tab } }));
}
