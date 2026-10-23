import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const planMessagesFile = (sessionId: string): string => path.join(
  process.env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker'),
  'vibe-message-times',
  `${path.basename(sessionId)}.plans.json`,
);

function readPlanMessages(sessionId: string): string[] {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(planMessagesFile(sessionId), 'utf8'));
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function isVibePlanMessage(sessionId: string | null, messageId: string): boolean {
  return Boolean(sessionId && readPlanMessages(sessionId).includes(messageId));
}

export function recordVibePlanMessage(record: unknown): void {
  if (!record || typeof record !== 'object') return;
  const { sessionId, id, role, type, turnId } = record as Record<string, unknown>;
  if (role !== 'assistant' || type !== 'message' || turnId == null || typeof sessionId !== 'string' || !sessionId || typeof id !== 'string' || !id) return;
  const ids = readPlanMessages(sessionId);
  if (ids.includes(id)) return;
  const file = planMessagesFile(sessionId);
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify([...ids, id]), { mode: 0o600 });
  fs.renameSync(temporary, file);
}
