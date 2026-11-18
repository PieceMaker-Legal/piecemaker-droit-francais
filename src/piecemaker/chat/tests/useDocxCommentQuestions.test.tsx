import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

const { useProcessingSessions } = vi.hoisted(() => ({ useProcessingSessions: vi.fn() }));

vi.mock('@/shared/context/SessionProtectionContext', () => ({ useProcessingSessions }));
vi.mock('@/modules/project-workspace/context/ProjectsStateContext', () => ({
  useOptionalProjectMainState: () => ({ selectedProject: { projectId: 'project-1' } }),
}));

import { askOpenChat, useDocxCommentQuestions } from '@/piecemaker/chat/useDocxCommentQuestions';

const handleSubmit = vi.fn(async () => undefined);

function renderChat(queuedDraft: { content: string; attachments: [] } | null = null, sessionId: string | null = 'session-1') {
  return renderHook(() => useDocxCommentQuestions({ sessionId, input: '', setInput: vi.fn(), queuedDraft, handleSubmit }));
}

beforeEach(() => {
  handleSubmit.mockClear();
  useProcessingSessions.mockReturnValue(new Map());
});

test('sends the question through the open chat', async () => {
  renderChat();
  await act(async () => {
    assert.equal(askOpenChat('project-1', 'session-1', 'Question ?'), true);
  });
  assert.deepEqual((handleSubmit.mock.calls[0] as unknown[])[1], { content: 'Question ?', attachments: [] });
});

test('starts a new conversation when the chat of the case has no session yet', async () => {
  renderChat(null, null);
  await act(async () => {
    assert.equal(askOpenChat('project-1', null, 'Question ?'), true);
  });
  assert.equal(handleSubmit.mock.calls.length, 1);
});

test('refuses another case, another session, a waiting message and background work', () => {
  assert.equal(askOpenChat('project-1', 'session-1', 'Question ?'), false);

  const chat = renderChat();
  assert.equal(askOpenChat('project-1', 'session-2', 'Question ?'), false);
  assert.equal(askOpenChat('project-1', null, 'Question ?'), false);
  assert.equal(askOpenChat('project-2', 'session-1', 'Question ?'), false);
  chat.unmount();

  const queued = renderChat({ content: 'En attente', attachments: [] });
  assert.equal(askOpenChat('project-1', 'session-1', 'Question ?'), false);
  queued.unmount();

  useProcessingSessions.mockReturnValue(new Map([['session-1', { background: true }]]));
  renderChat();
  assert.equal(askOpenChat('project-1', 'session-1', 'Question ?'), false);
  assert.equal(handleSubmit.mock.calls.length, 0);
});
