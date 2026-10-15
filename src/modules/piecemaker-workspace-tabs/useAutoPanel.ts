import { useEffect, useLayoutEffect, useRef } from 'react';

import { readWorkspaceContext } from '@/modules/piecemaker-context-suggestions';
import { autoPanelTarget, draftFromResult, panelShowDecision } from '@/modules/piecemaker-workspace-tabs/autoPanelRules';
import type { AutoPanelTarget } from '@/modules/piecemaker-workspace-tabs/autoPanelRules';
import { closeInEditor, openInEditor } from '@/piecemaker/editor-tabs/editorPanels';
import { showPlan } from '@/piecemaker/editor-tabs/planCalls';
import {
  acknowledgeWorkspacePanel,
  acknowledgeWorkspacePanelClose,
  pollWorkspacePanel,
  pollWorkspacePanelClose,
} from '@/shared/api';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { AppTab } from '@/shared/types';

const MAX_AGE_MS = 120_000;
const DOSSIER_TAB: AppTab = 'plugin:piecemaker-dossier';
const TABULAR_REVIEW_TAB: AppTab = 'plugin:piecemaker-tabular-review';
const TAMPON_TAB: AppTab = 'plugin:piecemaker-tampon';
const DOSSIER_VIEW_EVENT = 'piecemaker:dossier-view';
const DOSSIER_VIEW_KEY = '__piecemakerDossierView';
const TABULAR_REVIEW_SHOW_EVENT = 'piecemaker:tabular-review-show';
const TABULAR_REVIEW_SHOW_KEY = '__piecemakerTabularReviewShow';
const TAMPON_SHOW_EVENT = 'piecemaker:tampon-show';
const TAMPON_SHOW_KEY = '__piecemakerTamponShow';

type AutoPanelState = {
  sessionId: string | null;
  projectPath: string | null;
  openTab: (tab: AppTab) => void;
  closeTab: (tab: AppTab) => void;
};

type PendingWindow = Window & Record<string, unknown>;

function show(target: AutoPanelTarget, state: AutoPanelState, toolId: string) {
  if (panelShowDecision(target, readWorkspaceContext()) === 'skip') return;
  const pending = window as unknown as PendingWindow;
  if (target.kind === 'file') {
    openInEditor(target.path);
  } else if (target.kind === 'plan') {
    showPlan(target.plan, toolId || state.sessionId || 'session');
  } else if (target.kind === 'dossier') {
    pending[DOSSIER_VIEW_KEY] = target.view;
    state.openTab(DOSSIER_TAB);
    window.dispatchEvent(new Event(DOSSIER_VIEW_EVENT));
  } else if (target.kind === 'tampon') {
    pending[TAMPON_SHOW_KEY] = { project: state.projectPath };
    state.openTab(TAMPON_TAB);
    window.dispatchEvent(new Event(TAMPON_SHOW_EVENT));
  } else {
    pending[TABULAR_REVIEW_SHOW_KEY] = { project: state.projectPath, review: target.review, draft: target.draft ?? null };
    state.openTab(TABULAR_REVIEW_TAB);
    window.dispatchEvent(new Event(TABULAR_REVIEW_SHOW_EVENT));
  }
}

export function useAutoPanel(sessionId: string | null, projectPath: string | null, openTab: (tab: AppTab) => void, closeTab: (tab: AppTab) => void) {
  const { subscribe } = useWebSocket();
  const state = useRef<AutoPanelState>({ sessionId, projectPath, openTab, closeTab });

  useLayoutEffect(() => {
    state.current = { sessionId, projectPath, openTab, closeTab };
  });

  useEffect(() => {
    const seen = new Set<string>();
    const awaitingDraft = new Set<string>();
    return subscribe((event) => {
      if (event.kind === 'tool_result' && typeof event.toolId === 'string' && awaitingDraft.delete(event.toolId)) {
        const draft = draftFromResult(event.content);
        if (draft) show({ kind: 'tabular-review', review: null, draft }, state.current, event.toolId);
        return;
      }
      if (event.kind !== 'tool_use' || typeof event.toolName !== 'string') return;
      const current = state.current;
      if (current.sessionId && event.sessionId && event.sessionId !== current.sessionId) return;
      const toolId = typeof event.toolId === 'string' ? event.toolId : '';
      if (toolId && seen.has(toolId)) return;
      if (toolId) seen.add(toolId);
      const sentAt = Date.parse(String(event.timestamp ?? ''));
      if (Number.isFinite(sentAt) && Date.now() - sentAt > MAX_AGE_MS) return;
      const target = autoPanelTarget(event.toolName, event.toolInput);
      if (target?.kind === 'tabular-review' && target.awaitDraft && toolId) awaitingDraft.add(toolId);
      if (target) show(target, current, toolId);
    });
  }, [subscribe]);

  useEffect(() => {
    if (!projectPath) return;
    let active = true;
    let inFlight = false;
    const poll = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        const result = await pollWorkspacePanel(projectPath);
        const request = result.request;
        if (active && request) {
          let handled = false;
          if (request.tab === 'files' && request.document) {
            state.current.openTab('files');
            openInEditor(request.document);
            handled = true;
          } else if (request.tab === DOSSIER_TAB) {
            show({ kind: 'dossier', view: request.view === 'chronology' ? 'chronology' : 'general' }, state.current, request.id);
            handled = true;
          } else if (request.tab === TABULAR_REVIEW_TAB) {
            show({ kind: 'tabular-review', review: request.review ?? null, ...(request.draft ? { draft: request.draft } : {}) }, state.current, request.id);
            handled = true;
          } else if (request.tab === TAMPON_TAB) {
            show({ kind: 'tampon' }, state.current, request.id);
            handled = true;
          }
          if (handled) await acknowledgeWorkspacePanel(projectPath, request.id);
        }
        if (!active) return;
        const closing = await pollWorkspacePanelClose(projectPath);
        const closeRequest = closing.request;
        if (!active || !closeRequest) return;
        if (closeRequest.tab === 'files' && closeRequest.document) closeInEditor(closeRequest.document);
        else state.current.closeTab(closeRequest.tab as AppTab);
        await acknowledgeWorkspacePanelClose(projectPath, closeRequest.id);
      } catch {
        return;
      } finally {
        inFlight = false;
      }
    };
    const interval = window.setInterval(() => void poll(), 350);
    void poll();
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [projectPath]);
}
