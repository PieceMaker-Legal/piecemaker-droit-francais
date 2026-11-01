import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

const { useProcessingSessions } = vi.hoisted(() => ({ useProcessingSessions: vi.fn() }));

vi.mock('@/shared/context/SessionProtectionContext', () => ({ useProcessingSessions }));

import { askOpenChat, useDocxCommentQuestions } from '@/piecemaker/chat/useDocxCommentQuestions';

const handleSubmit = vi.fn(async () => undefined);

function renderChat(queuedDraft: { content: string; attachments: [] } | null = null) {
  return renderHook(() => useDocxCommentQuestions({ sessionId: 'session-1', input: '', setInput: vi.fn(), queuedDraft, handleSubmit }));
}

beforeEach(() => {
  handleSubmit.mockClear();
  useProcessingSessions.mockReturnValue(new Map());
});

test('sends the question through the open chat', async () => {
  renderChat();
  await act(async () => {
    assert.equal(askOpenChat('session-1', 'Question ?'), true);
  });
  assert.deepEqual((handleSubmit.mock.calls[0] as unknown[])[1], { content: 'Question ?', attachments: [] });
});

test('refuses another session, a waiting message and background work', () => {
  assert.equal(askOpenChat('session-1', 'Question ?'), false);

  const chat = renderChat();
  assert.equal(askOpenChat('session-2', 'Question ?'), false);
  chat.unmount();

  const queued = renderChat({ content: 'En attente', attachments: [] });
  assert.equal(askOpenChat('session-1', 'Question ?'), false);
  queued.unmount();

  useProcessingSessions.mockReturnValue(new Map([['session-1', { background: true }]]));
  renderChat();
  assert.equal(askOpenChat('session-1', 'Question ?'), false);
  assert.equal(handleSubmit.mock.calls.length, 0);
});
