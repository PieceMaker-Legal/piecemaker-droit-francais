import type { AppTab } from '@/shared/types';

export const PANEL_FOCUS_EVENT = 'piecemaker:panel-focus';

export type PanelFocus = { view?: string; file?: string | null; label?: string };

export type FocusTarget = { kind: 'panel'; tab: AppTab } | { kind: 'document'; path: string };

export type WorkspaceContext = {
  project: string | null;
  panels: readonly AppTab[];
  document: string | null;
  focus: Readonly<Record<string, PanelFocus>>;
  last: FocusTarget | null;
};

const EMPTY: WorkspaceContext = { project: null, panels: [], document: null, focus: {}, last: null };

let state = EMPTY;
const listeners = new Set<() => void>();

function update(next: WorkspaceContext) {
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener();
}

const sameFocus = (left: PanelFocus | undefined, right: PanelFocus) => left?.view === right.view && left?.file === right.file && left?.label === right.label;

export function subscribeWorkspaceContext(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const readWorkspaceContext = () => state;

export function syncPanels(project: string | null, panels: readonly AppTab[]) {
  if (project !== state.project) {
    update({ ...EMPTY, project, panels, last: panels.length ? { kind: 'panel', tab: panels[panels.length - 1] } : null });
    return;
  }
  if (panels.length === state.panels.length && panels.every((tab) => state.panels.includes(tab))) return;
  const opened = panels.filter((tab) => !state.panels.includes(tab));
  const last = opened.length ? { kind: 'panel' as const, tab: opened[opened.length - 1] }
    : state.last?.kind === 'panel' && !panels.includes(state.last.tab) ? null : state.last;
  update({ ...state, panels, last });
}

export function setActiveDocument(path: string | null) {
  if (path === state.document) return;
  const last = path ? { kind: 'document' as const, path } : state.last?.kind === 'document' ? null : state.last;
  update({ ...state, document: path, last });
}

export function focusPanel(tab: AppTab, focus: PanelFocus) {
  if (sameFocus(state.focus[tab], focus)) return;
  const last = state.panels.includes(tab) ? { kind: 'panel' as const, tab } : state.last;
  update({ ...state, focus: { ...state.focus, [tab]: focus }, last });
}

if (typeof window !== 'undefined') {
  window.addEventListener(PANEL_FOCUS_EVENT, (event) => {
    const detail = (event as CustomEvent<PanelFocus & { tab?: string }>).detail;
    if (!detail || typeof detail.tab !== 'string') return;
    const { tab, ...focus } = detail;
    focusPanel(tab as AppTab, focus);
  });
}
