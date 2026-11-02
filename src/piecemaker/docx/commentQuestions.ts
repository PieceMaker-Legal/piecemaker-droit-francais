const QUESTIONS_KEY = 'piecemaker:docx-comment-questions';
const MODE_KEY = 'piecemaker:docx-comment-ask';
const QUESTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type CommentQuestion = {
  token: string;
  sessionId: string | null;
  providerLabel: string;
  projectId: string;
  filePath: string;
  commentId: number;
  prompt: string;
  askedAt: number;
};

type TranscriptMessage = {
  kind?: string;
  role?: string;
  content?: unknown;
  timestamp?: string;
};

function readStored(): CommentQuestion[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(QUESTIONS_KEY) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return (stored as CommentQuestion[]).filter((question) => Date.now() - question.askedAt < QUESTION_MAX_AGE_MS);
  } catch {
    return [];
  }
}

function writeStored(questions: CommentQuestion[]) {
  try {
    localStorage.setItem(QUESTIONS_KEY, JSON.stringify(questions));
  } catch {
    return;
  }
}

export function readDocumentQuestions(projectId: string, filePath: string) {
  const stored = readStored();
  writeStored(stored);
  return stored.filter((question) => question.projectId === projectId && question.filePath === filePath);
}

export function storeQuestion(question: CommentQuestion) {
  writeStored([...readStored(), question]);
}

export function bindQuestionSession(token: string, sessionId: string) {
  writeStored(readStored().map((question) => question.token === token ? { ...question, sessionId } : question));
}

export function removeQuestion(token: string): boolean {
  const stored = readStored();
  const remaining = stored.filter((question) => question.token !== token);
  writeStored(remaining);
  return remaining.length !== stored.length;
}

export function readAskMode() {
  try {
    return localStorage.getItem(MODE_KEY) === 'on';
  } catch {
    return false;
  }
}

export function writeAskMode(enabled: boolean) {
  try {
    localStorage.setItem(MODE_KEY, enabled ? 'on' : 'off');
  } catch {
    return;
  }
}

export function createQuestionToken() {
  return `commentaire-${Math.random().toString(36).slice(2, 10)}`;
}

function quote(text: string) {
  return text.trim().split(/\r?\n/).map((line) => `> ${line}`).join('\n');
}

export type ThreadMessage = { author: string; text: string };

export function buildQuestionPrompt({ documentName, filePath, commentId, passage, paragraphs, thread = [], question }: {
  documentName: string;
  filePath: string;
  commentId: number;
  passage: string;
  paragraphs: string;
  thread?: ThreadMessage[];
  question: string;
}) {
  const hasContext = paragraphs.trim() && paragraphs.trim() !== passage.trim();
  return [
    thread.length > 0
      ? `Réponse dans le fil du commentaire c${commentId} du document « ${documentName} » (${filePath}).`
      : `Question posée en commentaire du document « ${documentName} » (${filePath}), commentaire c${commentId}.`,
    ...(passage.trim() ? [`Passage commenté :\n${quote(passage)}`] : []),
    ...(hasContext ? [`Paragraphe du passage :\n${quote(paragraphs)}`] : []),
    ...(thread.length > 0 ? [`Fil du commentaire :\n${thread.map(({ author, text }) => quote(`${author} : ${text}`)).join('\n>\n')}`] : []),
    question.trim(),
    `Ta réponse dans ce chat est copiée telle quelle en réponse au commentaire : réponds directement, sans décrire ta démarche. Ne modifie le document que si la question le demande, en suivi des modifications, au passage commenté (\`docx comments list\` donne l’ancre de c${commentId}).`,
  ].join('\n\n');
}

function sentSince(message: TranscriptMessage, askedAt: number) {
  const sentAt = Date.parse(message.timestamp ?? '');
  return Number.isNaN(sentAt) || sentAt >= askedAt;
}

export function readQuestionTurn(messages: TranscriptMessage[], prompt: string, askedAt: number): string | null {
  const start = messages.findIndex((message) => message.kind === 'text' && message.role === 'user' && String(message.content ?? '').includes(prompt) && sentSince(message, askedAt));
  if (start < 0) return null;
  const answers: string[] = [];
  for (const message of messages.slice(start + 1)) {
    if (message.kind !== 'text') continue;
    if (message.role === 'user') break;
    const text = String(message.content ?? '').trim();
    if (message.role === 'assistant' && text) answers.push(text);
  }
  return answers.join('\n\n');
}
