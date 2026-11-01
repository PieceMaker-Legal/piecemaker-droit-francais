import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import type { DocxEditorRef } from '@eigenpal/docx-editor-react';

const { askOpenChat, runningSessions, sessionMessages } = vi.hoisted(() => ({
  askOpenChat: vi.fn(),
  runningSessions: vi.fn(),
  sessionMessages: vi.fn(),
}));

vi.mock('@/modules/project-workspace/context/ProjectsStateContext', () => ({
  useOptionalProjectMainState: () => ({ selectedSession: { id: 'session-1', __provider: 'claude', __projectId: 'projet-1' } }),
}));
vi.mock('@/piecemaker/chat/useDocxCommentQuestions', () => ({ askOpenChat }));
vi.mock('@/shared/api', () => ({ api: { runningSessions, providers: { sessionMessages } } }));

import { writeAskMode } from '@/piecemaker/docx/commentQuestions';
import { useCommentQuestions } from '@/piecemaker/docx/useCommentQuestions';

const COMMENT = { id: 7, content: [{ type: 'paragraph', content: [{ type: 'run', content: [{ type: 'text', text: 'Ce délai est-il exact ?' }] }] }] } as unknown as Comment;
const replyToComment = vi.fn();

function jsonResponse(data: unknown) {
  return { ok: true, status: 200, json: async () => ({ data }) };
}

function renderQuestions() {
  const editor = { getComments: () => [COMMENT], replyToComment, getEditorRef: () => null } as unknown as DocxEditorRef;
  return renderHook(() => useCommentQuestions({
    projectId: 'projet-1',
    filePath: '/dossier/acte.docx',
    documentName: 'acte.docx',
    editorRef: { current: editor },
    onAnswered: vi.fn(),
  }));
}

function followTranscript(answer: string) {
  sessionMessages.mockImplementation(async () => {
    const prompt = String((askOpenChat.mock.calls[0] as unknown[])[1]);
    return jsonResponse({
      messages: [
        { kind: 'text', role: 'user', content: prompt, timestamp: new Date(Date.now() + 1000).toISOString() },
        { kind: 'text', role: 'assistant', content: answer },
      ],
    });
  });
}

beforeEach(() => {
  localStorage.clear();
  writeAskMode(true);
  askOpenChat.mockReset().mockReturnValue(true);
  replyToComment.mockReset().mockReturnValue({ id: 8 });
  sessionMessages.mockReset().mockResolvedValue(jsonResponse({ messages: [] }));
  runningSessions.mockReset().mockResolvedValue(jsonResponse({ sessions: [] }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('warns when the open chat refuses the question', () => {
  askOpenChat.mockReturnValue(false);
  const { result } = renderQuestions();
  act(() => result.current.askComment(COMMENT));
  assert.match(result.current.notice ?? '', /ne l’a pas reçu/);
  assert.equal(result.current.questions.length, 0);
});

test('warns when the turn ends without any answer', async () => {
  followTranscript('');
  const { result } = renderQuestions();
  act(() => result.current.askComment(COMMENT));
  await waitFor(() => assert.match(result.current.notice ?? '', /aucune réponse/));
  assert.equal(replyToComment.mock.calls.length, 0);
  assert.equal(result.current.questions.length, 0);
});

test('warns when the answer cannot be copied into the comment', async () => {
  followTranscript('Le délai est exact.');
  replyToComment.mockReturnValue(null);
  const { result } = renderQuestions();
  act(() => result.current.askComment(COMMENT));
  await waitFor(() => assert.match(result.current.notice ?? '', /n’a pas pu être copiée/));
  assert.deepEqual(replyToComment.mock.calls[0], [7, 'Le délai est exact.', 'Claude']);
});

test('warns when the question never reaches the chat after ten minutes', async () => {
  const askedAt = Date.now();
  const { result, unmount } = renderQuestions();
  act(() => result.current.askComment(COMMENT));
  await waitFor(() => assert.ok(sessionMessages.mock.calls.length > 0));
  assert.equal(result.current.notice, null);
  unmount();

  vi.spyOn(Date, 'now').mockReturnValue(askedAt + 11 * 60 * 1000);
  const { result: reopened } = renderQuestions();
  await waitFor(() => assert.match(reopened.current.notice ?? '', /n’a pas reçu la question/));
  assert.equal(reopened.current.questions.length, 0);
});
