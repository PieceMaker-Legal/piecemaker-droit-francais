import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSessionStore } from '@/piecemaker/chat/useMistralSessionStore';
import type { NormalizedMessage } from '@/shared/types';

const sessionMessages = vi.fn();
vi.mock('@/shared/api', () => ({ api: { providers: { sessionMessages: (...args: unknown[]) => sessionMessages(...args) } } }));

const reasoning = (content: string, sessionId = 'session-1'): NormalizedMessage => ({
  id: 'reason-1', sessionId, provider: 'mistral', kind: 'thinking', content,
  timestamp: '2026-01-01T00:00:00.000Z',
});

describe('Mistral reasoning stream', () => {
  it('updates one thinking row before the answer and isolates sessions', () => {
    const { result } = renderHook(() => useSessionStore());
    act(() => result.current.appendRealtime('session-1', reasoning('Je')));
    expect(result.current.getMessages('session-1').map((message) => message.content)).toEqual(['Je']);
    act(() => {
      result.current.appendRealtime('session-1', reasoning('Je réfléchis →'));
      result.current.appendRealtime('session-2', reasoning('Autre réflexion', 'session-2'));
      result.current.updateStreaming('session-1', 'Réponse', 'mistral');
      result.current.finalizeStreaming('session-1');
    });
    expect(result.current.getMessages('session-1').map((message) => message.content)).toEqual(['Je réfléchis →', 'Réponse']);
    expect(result.current.getMessages('session-2').map((message) => message.content)).toEqual(['Autre réflexion']);
  });

  it('reconciles reasoning with history and updates a row already loaded from history', async () => {
    sessionMessages.mockResolvedValue({ ok: true, json: async () => ({ data: {
      messages: [reasoning('Je')], total: 1, hasMore: false,
    } }) });
    const { result } = renderHook(() => useSessionStore());
    act(() => result.current.appendRealtime('session-1', reasoning('Je')));
    await act(async () => { await result.current.fetchFromServer('session-1', { limit: 20, offset: 0 }); });
    act(() => result.current.appendRealtime('session-1', reasoning('Je réfléchis')));
    expect(result.current.getMessages('session-1').map((message) => message.content)).toEqual(['Je réfléchis']);
  });
});
