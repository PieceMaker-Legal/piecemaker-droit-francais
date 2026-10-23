import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import crossSpawn from 'cross-spawn';

import { resolveVibeHome } from '@/modules/providers/list/mistral/mistral-runtime.provider.js';
import type { AnyRecord } from '@/shared/types.js';
import { readObjectRecord } from '@/shared/utils.js';
import { resolveVibeExecutable } from '@/shared/vibe-cli.js';

export async function readNativeVibeHistory(sessionId: string): Promise<AnyRecord[] | null> {
  if (!fs.existsSync(path.join(resolveVibeHome(), 'logs', 'session', 'unified', path.basename(sessionId)))) return null;
  return new Promise((resolve) => {
    const executable = resolveVibeExecutable();
    const server = executable === 'vibe' ? 'vibe-app-server' : path.join(path.dirname(executable), process.platform === 'win32' ? 'vibe-app-server.exe' : 'vibe-app-server');
    const child = crossSpawn(server, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const pages: AnyRecord[][] = [];
    const cursors = new Set<string>();
    let count = 0;
    let requestId = 1;
    let finished = false;
    const finish = (records: AnyRecord[] | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      child.stdin?.end();
      const stop = setTimeout(() => { if (child.exitCode === null) child.kill('SIGTERM'); }, 2000);
      stop.unref();
      resolve(records);
    };
    const timeout = setTimeout(() => finish(null), 120_000);
    const send = (method: string, params: AnyRecord, id?: number) => child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', ...(id ? { id } : {}), method, params })}\n`);
    const page = (cursor?: string) => send('session/history/list', { sessionId, page: { limit: 500, direction: 'backward', ...(cursor ? { cursor } : {}) } }, ++requestId);
    child.on('error', () => finish(null));
    child.on('close', () => finish(null));
    child.stdin?.on('error', () => finish(null));
    if (!child.stdout) return finish(null);
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      if (finished) return;
      let response;
      try { response = readObjectRecord(JSON.parse(line)); } catch { return; }
      if (!response || response.id !== requestId) return;
      if (response.error) return finish(null);
      if (requestId === 1) {
        send('initialized', {});
        page();
        return;
      }
      const result = readObjectRecord(response.result);
      if (!result || !Array.isArray(result.items)) return finish(null);
      const items = result.items.map(readObjectRecord).filter((record): record is AnyRecord => Boolean(record));
      count += items.length;
      if (count > 10_000) return finish(null);
      pages.unshift(items);
      const cursor = typeof result.nextCursor === 'string' ? result.nextCursor : null;
      if (!cursor) return finish(pages.flat());
      if (!items.length || cursors.has(cursor)) return finish(null);
      cursors.add(cursor);
      page(cursor);
    });
    send('initialize', { clientInfo: { name: 'piecemaker_history', version: '1.0.0' }, capabilities: {} }, requestId);
  });
}
