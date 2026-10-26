import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import type { ChatCompletionRequest } from '@mistralai/mistralai/models/components';

import type { NormalizedMessage } from '@/shared/types.js';

export function createMistralHistory(home: string) {
  const file = (sessionId: string) => path.join(home, 'mistral-sdk', 'sessions', `${createHash('sha256').update(sessionId).digest('hex')}.json`);
  return {
    async load(sessionId: string) {
      try {
        return JSON.parse(await fs.readFile(file(sessionId), 'utf8')) as {
          userId: number;
          messages: ChatCompletionRequest['messages'];
          transcript: NormalizedMessage[];
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async save(sessionId: string, record: { userId: number; messages: ChatCompletionRequest['messages']; transcript: NormalizedMessage[] }) {
      const destination = file(sessionId);
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
        await fs.rename(temporary, destination);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    },
  };
}
