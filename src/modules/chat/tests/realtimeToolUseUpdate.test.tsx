import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { describe, it, vi } from 'vitest';

import type { NormalizedMessage } from '@/shared/types';

vi.mock('@/shared/api', () => ({ api: { providers: { sessionMessages: vi.fn() } } }));

const bash = (status: string): NormalizedMessage => ({
  id: 'item_1',
  kind: 'tool_use',
  provider: 'codex',
  sessionId: 'session-1',
  toolName: 'Bash',
  toolInput: { command: 'ls' },
  toolId: 'item_1',
  status,
  timestamp: '2026-01-01T00:00:01.000Z',
} as NormalizedMessage);

describe('appendRealtime', () => {
  it('remplace sur place un tool_use déjà reçu au lieu de le doubler', async () => {
    const { useSessionStore } = await import('@/modules/chat/hooks/useSessionStore');
    const { result } = renderHook(() => useSessionStore());

    act(() => {
      result.current.appendRealtime('session-1', bash('in_progress'));
      result.current.appendRealtime('session-1', { ...bash('completed'), id: 'item_2', toolId: 'item_2' } as NormalizedMessage);
      result.current.appendRealtime('session-1', bash('completed'));
    });

    assert.deepEqual(
      result.current.getMessages('session-1').map((message) => [message.toolId, message.status]),
      [['item_1', 'completed'], ['item_2', 'completed']],
    );
  });
});
