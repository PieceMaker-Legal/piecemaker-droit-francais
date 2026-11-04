import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { useCatalaUpdates } from '@/modules/piecemaker-catala';
import type { ServerEvent } from '@/shared/types';

const socket = vi.hoisted(() => ({ listener: null as ((event: ServerEvent) => void) | null, unsubscribe: vi.fn() }));
vi.mock('@/shared/context/WebSocketContext', () => ({ useWebSocket: () => ({ subscribe: (listener: (event: ServerEvent) => void) => { socket.listener = listener; return socket.unsubscribe; } }) }));

it('relays completed Catala updates and reconnection through the existing socket subscription', () => {
  const received: unknown[] = [];
  const record = (event: Event) => received.push((event as CustomEvent).detail);
  window.addEventListener('piecemaker:catala-updated', record);
  const hook = renderHook(useCatalaUpdates);
  try {
    act(() => {
      socket.listener!({ type: 'other' });
      socket.listener!({ type: 'piecemaker-catala-updated', projectPath: '/dossier-fictif' });
      socket.listener!({ type: 'piecemaker-catala-updated', projectPath: 12 });
      socket.listener!({ kind: 'websocket_reconnected' });
    });
    expect(received).toEqual([{ projectPath: '/dossier-fictif' }, null]);
    hook.unmount();
    expect(socket.unsubscribe).toHaveBeenCalledOnce();
  } finally { window.removeEventListener('piecemaker:catala-updated', record); }
});
