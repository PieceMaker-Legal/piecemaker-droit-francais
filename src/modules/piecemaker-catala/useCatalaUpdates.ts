import { useEffect } from 'react';

import { useWebSocket } from '@/shared/context/WebSocketContext';

export function useCatalaUpdates() {
  const { subscribe } = useWebSocket();
  useEffect(() => subscribe((event) => {
    if (event.type === 'piecemaker-catala-updated' && typeof event.projectPath === 'string') {
      window.dispatchEvent(new CustomEvent('piecemaker:catala-updated', { detail: { projectPath: event.projectPath } }));
    }
    if (event.kind === 'websocket_reconnected') window.dispatchEvent(new CustomEvent('piecemaker:catala-updated'));
  }), [subscribe]);
}
