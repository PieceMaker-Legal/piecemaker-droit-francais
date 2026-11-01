const QUESTIONS_KEY = 'piecemaker:docx-comment-questions';
const MODE_KEY = 'piecemaker:docx-comment-ask';

export type CommentQuestion = {
  token: string;
  sessionId: string;
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
    return Array.isArray(stored) ? stored as CommentQuestion[] : [];
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
  return readStored().filter((question) => question.projectId === projectId && question.filePath === filePath);
}

export function storeQuestion(question: CommentQuestion) {
  writeStored([...readStored(), question]);
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

export function buildQuestionPrompt({ documentName, filePath, passage, paragraphs, question }: {
  documentName: string;
  filePath: string;
  passage: string;
  paragraphs: string;
  question: string;
}) {
  const hasContext = paragraphs.trim() && paragraphs.trim() !== passage.trim();
  return [
    `Question posée en commentaire du document « ${documentName} » (${filePath}).`,
    ...(passage.trim() ? [`Passage commenté :\n${quote(passage)}`] : []),
    ...(hasContext ? [`Paragraphe du passage :\n${quote(paragraphs)}`] : []),
    question.trim(),
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
