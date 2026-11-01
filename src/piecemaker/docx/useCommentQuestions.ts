import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { DocxEditorRef } from '@eigenpal/docx-editor-react';
import { getCommentText } from '@eigenpal/docx-editor-core/utils/comments';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';

import { useOptionalProjectMainState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { askOpenChat } from '@/piecemaker/chat/useDocxCommentQuestions';
import {
  buildQuestionPrompt,
  createQuestionToken,
  readAskMode,
  readDocumentQuestions,
  readQuestionTurn,
  removeQuestion,
  storeQuestion,
  writeAskMode,
} from '@/piecemaker/docx/commentQuestions';
import type { CommentQuestion } from '@/piecemaker/docx/commentQuestions';
import { api } from '@/shared/api';
import { MCP_PROVIDER_NAMES } from '@/shared/constants';

const ANSWER_POLL_MS = 3000;
const RECENT_MESSAGES = 200;
const UNSENT_QUESTION_MS = 10 * 60 * 1000;

type UseCommentQuestionsOptions = {
  projectId?: string;
  filePath?: string;
  documentName: string;
  editorRef: RefObject<DocxEditorRef>;
  onAnswered: () => void;
  onRefused: (message: string) => void;
};

async function readMessages(sessionId: string, limit: number | null) {
  const response = await api.providers.sessionMessages(sessionId, { limit });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  const messages: unknown = (body?.data ?? body)?.messages;
  return Array.isArray(messages) ? messages : [];
}

async function readRunningSessions() {
  const response = await api.runningSessions();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  const sessions: { sessionId: string }[] = body?.data?.sessions ?? [];
  return new Set(sessions.map((session) => session.sessionId));
}

function commentedPassage(editor: DocxEditorRef | null, commentId: number) {
  const view = editor?.getEditorRef()?.getView();
  if (!view) return { passage: '', paragraphs: '' };
  let passage = '';
  const paragraphs = new Set<string>();
  view.state.doc.descendants((node, _position, parent) => {
    if (!node.isText || !node.marks.some((mark) => mark.type.name === 'comment' && mark.attrs.commentId === commentId)) return;
    passage += node.text ?? '';
    if (parent) paragraphs.add(parent.textContent);
  });
  return { passage, paragraphs: [...paragraphs].join('\n') };
}

export function useCommentQuestions({ projectId, filePath, documentName, editorRef, onAnswered, onRefused }: UseCommentQuestionsOptions) {
  const selectedSession = useOptionalProjectMainState()?.selectedSession;
  const sessionId = selectedSession?.id ?? null;
  const provider = selectedSession?.__provider;
  const providerLabel = provider && selectedSession?.__projectId === projectId ? MCP_PROVIDER_NAMES[provider] : null;
  const [askEnabled, setAskEnabled] = useState(readAskMode);
  const [questions, setQuestions] = useState<CommentQuestion[]>([]);
  const [partialAnswers, setPartialAnswers] = useState<Record<string, string>>({});
  const polling = useRef(false);
  const callbacks = useRef({ onAnswered, onRefused });
  callbacks.current = { onAnswered, onRefused };

  useEffect(() => {
    setQuestions(projectId && filePath ? readDocumentQuestions(projectId, filePath) : []);
    setPartialAnswers({});
  }, [filePath, projectId]);

  const changeAskEnabled = useCallback((enabled: boolean) => {
    writeAskMode(enabled);
    setAskEnabled(enabled);
  }, []);

  const finish = useCallback((token: string) => {
    removeQuestion(token);
    setQuestions((current) => current.filter((question) => question.token !== token));
  }, []);

  const askComment = useCallback((comment: Comment) => {
    if (!askEnabled || !providerLabel || !sessionId || !projectId || !filePath) return;
    const token = createQuestionToken();
    const prompt = buildQuestionPrompt({
      documentName,
      filePath,
      ...commentedPassage(editorRef.current, comment.id),
      question: getCommentText(comment.content),
    });
    const question = { token, sessionId, providerLabel, projectId, filePath, commentId: comment.id, prompt, askedAt: Date.now() };
    storeQuestion(question);
    if (!askOpenChat(sessionId, prompt)) {
      removeQuestion(token);
      callbacks.current.onRefused(`Le commentaire est enregistré, mais ${providerLabel} ne l’a pas reçu : le chat n’est pas ouvert ou un message y attend déjà.`);
      return;
    }
    setQuestions((current) => [...current, question]);
  }, [askEnabled, documentName, editorRef, filePath, projectId, providerLabel, sessionId]);

  const forgetComment = useCallback((comment: Comment) => {
    setQuestions((current) => {
      current.filter((question) => question.commentId === comment.id).forEach((question) => removeQuestion(question.token));
      return current.filter((question) => question.commentId !== comment.id);
    });
  }, []);

  useEffect(() => {
    if (questions.length === 0) return undefined;
    const followQuestion = async (question: CommentQuestion, running: Set<string>) => {
      const isRunning = running.has(question.sessionId);
      let turn = readQuestionTurn(await readMessages(question.sessionId, RECENT_MESSAGES), question.prompt, question.askedAt);
      if (turn === null && !isRunning) turn = readQuestionTurn(await readMessages(question.sessionId, null), question.prompt, question.askedAt);
      if (turn === null) {
        if (!isRunning && Date.now() - question.askedAt > UNSENT_QUESTION_MS) finish(question.token);
        return;
      }
      if (isRunning) {
        setPartialAnswers((current) => current[question.token] === turn ? current : { ...current, [question.token]: turn ?? '' });
        return;
      }
      if (!turn) {
        finish(question.token);
        return;
      }
      const editor = editorRef.current;
      const comments = editor?.getComments() ?? [];
      if (!editor || comments.length === 0) return;
      if (!comments.some((comment) => comment.id === question.commentId)) {
        finish(question.token);
        return;
      }
      if (!removeQuestion(question.token)) {
        finish(question.token);
        return;
      }
      if (editor.replyToComment(question.commentId, turn, question.providerLabel) !== null) callbacks.current.onAnswered();
      finish(question.token);
    };
    const poll = async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        const running = await readRunningSessions();
        await Promise.all(questions.map((question) => followQuestion(question, running).catch(() => undefined)));
      } catch {
        return;
      } finally {
        polling.current = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, ANSWER_POLL_MS);
    return () => window.clearInterval(timer);
  }, [editorRef, finish, questions]);

  return { providerLabel, askEnabled, changeAskEnabled, askComment, forgetComment, questions, partialAnswers };
}
