import type { providerRuntimeService, sessionsService } from '@/modules/providers/index.js';
import type { NormalizedMessage, ProviderRuntimeWriter } from '@/shared/types.js';

type Sessions = Pick<typeof sessionsService, 'fetchHistory'>;

function parse(data: unknown): NormalizedMessage | null {
  if (typeof data === 'string') {
    try { return JSON.parse(data) as NormalizedMessage; } catch { return null; }
  }
  return data && typeof data === 'object' ? data as NormalizedMessage : null;
}

async function rewrite(message: NormalizedMessage, sessionId: string, turnStart: number, sessions: Sessions): Promise<NormalizedMessage[]> {
  if (message.kind === 'status' && message.text === 'token_budget') {
    const usage = (await sessions.fetchHistory(sessionId, { limit: 1, offset: 0 })).tokenUsage as { used?: number; total?: number } | undefined;
    if (!usage?.used) return [message];
    const budget = message.tokenBudget as Record<string, unknown>;
    return [{ ...message, tokenBudget: { ...budget, used: usage.used, total: usage.total || budget.total } }];
  }
  if (message.kind === 'tool_use' && message.toolName === 'collab_tool_call') {
    const history = await sessions.fetchHistory(sessionId, { limit: null, offset: 0 });
    const tasks = history.messages.filter((row) => row.kind === 'tool_use' && row.toolName === 'Task' && Date.parse(row.timestamp) >= turnStart);
    return tasks.length ? tasks : [message];
  }
  return [message];
}

export function installCodexEventsRuntime(runtime: Pick<typeof providerRuntimeService, 'run'>, sessions: Sessions) {
  const run = runtime.run.bind(runtime);
  runtime.run = async (provider, command, options, writer) => {
    const sessionId = typeof options.sessionId === 'string' ? options.sessionId : '';
    if (provider !== 'codex' || !sessionId || !writer) return run(provider, command, options, writer);
    const turnStart = Date.now() - 1000;
    let queue = Promise.resolve();
    const wrapped = new Proxy(writer, {
      get(target, key) {
        if (key !== 'send') {
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return (data: unknown) => {
          const message = parse(data);
          queue = queue.then(async () => {
            if (!message) return target.send(data);
            const rows = await rewrite(message, sessionId, turnStart, sessions).catch(() => [message]);
            for (const row of rows) target.send(typeof data === 'string' ? JSON.stringify(row) : row);
          });
        };
      },
    }) as ProviderRuntimeWriter;
    try {
      return await run(provider, command, options, wrapped);
    } finally {
      await queue;
    }
  };
}
