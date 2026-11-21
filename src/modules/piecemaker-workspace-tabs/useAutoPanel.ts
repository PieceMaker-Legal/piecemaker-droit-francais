import { useEffect, useLayoutEffect, useRef } from 'react';

import { readWorkspaceContext } from '@/modules/piecemaker-context-suggestions';
import { useWorkspaceListening } from '@/modules/piecemaker-workspace-tabs/agent/subagent';
import { OPEN_PANEL_EVENT } from '@/modules/piecemaker-workspace-tabs/requestWorkspacePanel';
import { artifactFromResult, autoPanelTarget, draftFromResult, isArtifactPublish, panelShowDecision } from '@/modules/piecemaker-workspace-tabs/autoPanelRules';
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

const HIDDEN_POLL_MS = 5_000;
const MAX_AGE_MS = 120_000;
const DOSSIER_TAB: AppTab = 'plugin:piecemaker-dossier';
const TABULAR_REVIEW_TAB: AppTab = 'plugin:piecemaker-tabular-review';
const TAMPON_TAB: AppTab = 'plugin:piecemaker-tampon';
const PLAIN_TABS: readonly AppTab[] = ['plugin:piecemaker-echeances', 'plugin:piecemaker-catala'];
const DOSSIER_VIEW_EVENT = 'piecemaker:dossier-view';
const DOSSIER_VIEW_KEY = '__piecemakerDossierView';
const TABULAR_REVIEW_SHOW_EVENT = 'piecemaker:tabular-review-show';
const TABULAR_REVIEW_SHOW_KEY = '__piecemakerTabularReviewShow';
const TAMPON_SHOW_EVENT = 'piecemaker:tampon-show';
const TAMPON_SHOW_KEY = '__piecemakerTamponShow';
const ARTIFACTS_TAB: AppTab = 'plugin:piecemaker-artifacts';
const ARTIFACTS_SHOW_EVENT = 'piecemaker:artifacts-show';
const ARTIFACTS_SHOW_KEY = '__piecemakerArtifactsShow';

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
  const listening = useWorkspaceListening();
  const state = useRef<AutoPanelState>({ sessionId, projectPath, openTab, closeTab });

  useLayoutEffect(() => {
    state.current = { sessionId, projectPath, openTab, closeTab };
  });

  useEffect(() => {
    const open = (event: Event) => {
      if (!listening()) return;
      const tab = (event as CustomEvent<{ tab?: unknown }>).detail?.tab;
      if (typeof tab === 'string') state.current.openTab(tab as AppTab);
    };
    window.addEventListener(OPEN_PANEL_EVENT, open);
    return () => window.removeEventListener(OPEN_PANEL_EVENT, open);
  }, [listening]);

  useEffect(() => {
    const seen = new Set<string>();
    const awaitingDraft = new Set<string>();
    const awaitingArtifact = new Set<string>();
    return subscribe((event) => {
      if (event.kind === 'tool_result' && typeof event.toolId === 'string' && awaitingArtifact.delete(event.toolId)) {
        const artifact = artifactFromResult(event.content);
        if (artifact) {
          (window as unknown as PendingWindow)[ARTIFACTS_SHOW_KEY] = { project: state.current.projectPath, artifact, preserveReview: true };
          state.current.openTab(ARTIFACTS_TAB);
          window.dispatchEvent(new Event(ARTIFACTS_SHOW_EVENT));
        }
        return;
      }
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
      if (toolId && isArtifactPublish(event.toolName, event.toolInput)) awaitingArtifact.add(toolId);
      const target = autoPanelTarget(event.toolName, event.toolInput);
      if (target?.kind === 'tabular-review' && target.awaitDraft && toolId) awaitingDraft.add(toolId);
      if (target) show(target, current, toolId);
    });
  }, [subscribe]);

  useEffect(() => {
    if (!projectPath) return;
    let active = true;
    let inFlight = false;
    let lastPollAt = 0;
    const poll = async () => {
      if (!active || inFlight) return;
      if (document.hidden && Date.now() - lastPollAt < HIDDEN_POLL_MS) return;
      lastPollAt = Date.now();
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
            show({ kind: 'dossier', view: request.view === 'chronology' || request.view === 'index-analysis' ? request.view : 'general' }, state.current, request.id);
            handled = true;
          } else if (request.tab === TABULAR_REVIEW_TAB) {
            show({ kind: 'tabular-review', review: request.review ?? null, ...(request.draft ? { draft: request.draft } : {}) }, state.current, request.id);
            handled = true;
          } else if (request.tab === TAMPON_TAB) {
            show({ kind: 'tampon', reload: true }, state.current, request.id);
            handled = true;
          } else if (request.tab === ARTIFACTS_TAB) {
            (window as unknown as PendingWindow)[ARTIFACTS_SHOW_KEY] = { project: projectPath, artifact: request.review ?? null };
            state.current.openTab(ARTIFACTS_TAB);
            window.dispatchEvent(new Event(ARTIFACTS_SHOW_EVENT));
            handled = true;
          } else if (PLAIN_TABS.includes(request.tab as AppTab)) {
            state.current.openTab(request.tab as AppTab);
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
