import { useCallback, useEffect, useRef, useState } from 'react';

import { agentApi } from '@/modules/piecemaker-agent/api';
import type { AgentState } from '@/modules/piecemaker-agent/api';

const POLL_MS = 2_000;

export function useAgentState(project: string) {
  const [state, setState] = useState<AgentState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await agentApi.state(project);
      if (!alive.current) return;
      setState((current) => current && current.revision === next.revision && current.orchestrator.running === next.orchestrator.running
        && JSON.stringify(current.providers) === JSON.stringify(next.providers) ? current : next);
      setError(null);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [project]);

  useEffect(() => {
    alive.current = true;
    setState(null);
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, POLL_MS);
    return () => { alive.current = false; window.clearInterval(timer); };
  }, [refresh]);

  const act = useCallback(async (path: string, body: Record<string, unknown> = {}, method: 'POST' | 'PUT' = 'POST') => {
    try {
      const result = method === 'PUT' ? await agentApi.put(path, project, body) : await agentApi.post(path, project, body);
      await refresh();
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    }
  }, [project, refresh]);

  return { state, error, refresh, act };
}

export type AgentActions = ReturnType<typeof useAgentState>['act'];
