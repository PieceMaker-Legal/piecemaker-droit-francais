import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const timesFile = (vibeSessionId: string): string => path.join(
  process.env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker'),
  'vibe-message-times',
  `${path.basename(vibeSessionId)}.json`,
);

export function readVibeMessageTimes(vibeSessionId: string): Record<string, string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(timesFile(vibeSessionId), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function recordVibeMessageTime(record: unknown): void {
  if (typeof record !== 'object' || record === null) return;
  const { sessionId, id, createdAt, turnId } = record as Record<string, unknown>;
  if (typeof sessionId !== 'string' || !sessionId || typeof id !== 'string' || typeof createdAt !== 'number' || turnId == null) return;
  const times = readVibeMessageTimes(sessionId);
  if (times[id]) return;
  times[id] = new Date(createdAt).toISOString();
  const file = timesFile(sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(times));
  fs.renameSync(`${file}.tmp`, file);
}
