import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import type { DocxEditorRef } from '@eigenpal/docx-editor-react';

const { askOpenChat, mainState, runningSessions, sessionMessages } = vi.hoisted(() => ({
  askOpenChat: vi.fn(),
  mainState: { current: {} as Record<string, unknown> },
  runningSessions: vi.fn(),
  sessionMessages: vi.fn(),
}));

vi.mock('@/modules/project-workspace/context/ProjectsStateContext', () => ({
  useOptionalProjectMainState: () => mainState.current,
}));
vi.mock('@/shared/hooks/useSelectedProvider', () => ({ useSelectedProvider: () => 'mistral' }));
vi.mock('@/piecemaker/chat/useDocxCommentQuestions', () => ({ askOpenChat }));
vi.mock('@/shared/api', () => ({ api: { runningSessions, providers: { sessionMessages } } }));

import { writeAskMode } from '@/piecemaker/docx/commentQuestions';
import { useCommentQuestions } from '@/piecemaker/docx/useCommentQuestions';

const PROJECT = { projectId: 'projet-1' };
const SESSION = { id: 'session-1', __provider: 'claude', __projectId: 'projet-1' };
const COMMENT = { id: 7, content: [{ type: 'paragraph', content: [{ type: 'run', content: [{ type: 'text', text: 'Ce délai est-il exact ?' }] }] }] } as unknown as Comment;
const replyToComment = vi.fn();

function jsonResponse(data: unknown) {
  return { ok: true, status: 200, json: async () => ({ data }) };
}

function commentOf(id: number, text: string, extra: Partial<Comment> = {}) {
  return { id, content: [{ type: 'paragraph', content: [{ type: 'run', content: [{ type: 'text', text }] }] }], ...extra } as unknown as Comment;
}

function renderQuestions(comments: Comment[] = [COMMENT]) {
  const editor = { getComments: () => comments, replyToComment, getEditorRef: () => null } as unknown as DocxEditorRef;
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
    const prompt = String((askOpenChat.mock.calls[0] as unknown[])[2]);
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
  mainState.current = { selectedProject: PROJECT, selectedSession: SESSION };
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

test('asks the provider chosen for a new conversation, then follows the session it opens', async () => {
  mainState.current = { selectedProject: PROJECT, selectedSession: null };
  followTranscript('Le délai est exact.');
  const { result, rerender } = renderQuestions();
  assert.equal(result.current.providerLabel, 'Mistral');
  act(() => result.current.askComment(COMMENT));
  assert.deepEqual((askOpenChat.mock.calls[0] as unknown[]).slice(0, 2), ['projet-1', null]);
  assert.equal(sessionMessages.mock.calls.length, 0);

  mainState.current = { selectedProject: PROJECT, selectedSession: { ...SESSION, id: 'session-2', __provider: 'mistral' } };
  rerender();
  await waitFor(() => assert.deepEqual(replyToComment.mock.calls[0], [7, 'Le délai est exact.', 'Mistral']), { timeout: 5000 });
  assert.equal(sessionMessages.mock.calls[0][0], 'session-2');
});

test('offers no question for a document of another case', () => {
  mainState.current = { selectedProject: { projectId: 'projet-2' }, selectedSession: null };
  assert.equal(renderQuestions().result.current.providerLabel, null);
});

test('sends a reply in the thread with the earlier exchange and answers under the same comment', async () => {
  const parent = commentOf(7, 'Ce délai est-il exact ?', { author: 'Jean Dupont' });
  const answer = commentOf(8, 'Oui, huit jours.', { author: 'Claude', parentId: 7 });
  const reply = commentOf(9, 'Et en appel ?', { author: 'Jean Dupont', parentId: 7 });
  followTranscript('Quinze jours.');
  const { result } = renderQuestions([parent, answer, reply]);
  act(() => result.current.askReply(reply, parent));
  const prompt = String((askOpenChat.mock.calls[0] as unknown[])[2]);
  assert.match(prompt, /^Réponse dans le fil du commentaire c7/);
  assert.match(prompt, /Fil du commentaire :\n> Jean Dupont : Ce délai est-il exact \?\n>\n> Claude : Oui, huit jours\.\n\nEt en appel \?/);
  await waitFor(() => assert.deepEqual(replyToComment.mock.calls[0], [7, 'Quinze jours.', 'Claude']));
});

test('keeps a reply in the thread when sending to the assistant is off', () => {
  writeAskMode(false);
  const { result } = renderQuestions();
  act(() => result.current.askReply(commentOf(9, 'Merci.', { parentId: 7 }), COMMENT));
  assert.equal(askOpenChat.mock.calls.length, 0);
});
