import { useEffect, useState } from 'react';

import { agentApi } from '@/modules/piecemaker-workspace-tabs/agent/agentApi';
import type { CentralAgent } from '@/modules/piecemaker-workspace-tabs/agent/agentApi';

let pending: Promise<CentralAgent | null> | null = null;

/** Used by the sidebar module to pin the central agent above the folders and keep its own folder out of the folder list. */
export function useCentralAgent() {
  const [central, setCentral] = useState<CentralAgent | null>(null);
  useEffect(() => {
    let alive = true;
    pending ??= agentApi.central().catch(() => { pending = null; return null; });
    void pending.then((value) => { if (alive) setCentral(value); });
    return () => { alive = false; };
  }, []);
  return central;
}
