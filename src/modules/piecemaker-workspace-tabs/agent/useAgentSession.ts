import { useEffect, useState } from 'react';

import { agentApi } from '@/modules/piecemaker-workspace-tabs/agent/agentApi';

export function useAgentSession(projectPath: string | null, sessionId: string | null) {
  const [agent, setAgent] = useState<{ projectPath: string; sessionId: string | null } | null>(null);

  useEffect(() => {
    if (!projectPath || !sessionId) return;
    let alive = true;
    agentApi.sessionId(projectPath)
      .then((result) => { if (alive) setAgent({ projectPath, sessionId: result.sessionId }); })
      .catch(() => { if (alive) setAgent(null); });
    return () => { alive = false; };
  }, [projectPath, sessionId]);

  return Boolean(sessionId && agent?.projectPath === projectPath && agent.sessionId === sessionId);
}
