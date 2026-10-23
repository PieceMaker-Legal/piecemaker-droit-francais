import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { resolveVibeHome } from '@/modules/providers/list/mistral/mistral-runtime.provider.js';
import type { AnyRecord } from '@/shared/types.js';
import { readObjectRecord } from '@/shared/utils.js';

const originFile = (sessionId: string) => path.join(
  process.env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker'),
  'vibe-session-origins', `${path.basename(sessionId)}.json`,
);

export async function readLegacyVibeSession(sessionId: string): Promise<{ records: AnyRecord[]; startTime: unknown; sessionId: string } | null> {
  const root = path.join(resolveVibeHome(), 'logs', 'session');
  let entries: string[];
  try { entries = await fs.readdir(root); } catch { return null; }
  for (const entry of entries.filter((name) => name.endsWith(`_${sessionId.slice(0, 8)}`))) {
    try {
      const meta = JSON.parse(await fs.readFile(path.join(root, entry, 'meta.json'), 'utf8'));
      if (meta?.session_id !== sessionId) continue;
      const records = (await fs.readFile(path.join(root, entry, 'messages.jsonl'), 'utf8')).split('\n').flatMap((line) => {
        try {
          const record = readObjectRecord(JSON.parse(line));
          return record ? [record] : [];
        } catch { return []; }
      });
      return { records, startTime: meta.start_time, sessionId };
    } catch {}
  }
  return null;
}

export async function recordLegacyVibeSessionOrigin(sessionId: string, legacySessionId: string): Promise<void> {
  if (sessionId === legacySessionId || !await readLegacyVibeSession(legacySessionId)) return;
  const file = originFile(sessionId);
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(temporary, JSON.stringify({ legacySessionId }), { mode: 0o600 });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function readLegacyVibeSessionOrigin(sessionId: string) {
  try {
    const origin = JSON.parse(await fs.readFile(originFile(sessionId), 'utf8'));
    return typeof origin.legacySessionId === 'string' ? await readLegacyVibeSession(origin.legacySessionId) : null;
  } catch { return null; }
}
