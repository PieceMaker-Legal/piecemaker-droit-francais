import { useMemo } from 'react';

import { useSessionStore as useCloudSessionStore } from '@/modules/chat/hooks/useSessionStore';
import type { NormalizedMessage } from '@/shared/types';

export function useSessionStore() {
  const store = useCloudSessionStore();
  return useMemo(() => ({
    ...store,
    appendRealtime(sessionId: string, message: NormalizedMessage) {
      if (message.provider === 'mistral' && message.kind === 'thinking') {
        const slot = store.getSessionSlot(sessionId);
        if (slot) {
          slot.realtimeMessages = slot.realtimeMessages.filter((previous) => previous.id !== message.id);
          slot.serverMessages = slot.serverMessages.map((previous) => previous.id === message.id ? message : previous);
        }
      }
      store.appendRealtime(sessionId, message);
    },
  }), [store]);
}
