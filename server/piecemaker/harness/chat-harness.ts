import type { providerRuntimeService, sessionsService } from '@/modules/providers/index.js';
import type { NormalizedMessage, ProviderRuntimeWriter } from '@/shared/types.js';
import { createNormalizedMessage } from '@/shared/utils.js';

import { createCitationTurn } from './citation-turn.js';
import type { createCitationStore } from './citation-store.js';
import { withCitationInstructions, withoutCitationInstructions } from './citation-instructions.js';

export function installChatCitationHarness(options: {
  runtime: Pick<typeof providerRuntimeService, 'run' | 'getRunner'>;
  sessions: Pick<typeof sessionsService, 'fetchHistory' | 'getSessionDetailsById'>;
  store: ReturnType<typeof createCitationStore>;
  ensureProxy: () => void;
}) {
  const run = options.runtime.run.bind(options.runtime);
  const getRunner = options.runtime.getRunner.bind(options.runtime);
  const fetchHistory = options.sessions.fetchHistory.bind(options.sessions);

  options.runtime.run = async (provider, command, runtimeOptions, writer) => {
    options.ensureProxy();
    if (provider !== 'claude' && provider !== 'codex') return run(provider, command, runtimeOptions, writer);
    const sessionId = String(runtimeOptions.sessionId ?? '');
    const cwd = String(runtimeOptions.cwd ?? runtimeOptions.projectPath ?? '');
    const turn = createCitationTurn({
      cwd, sessionId, store: options.store,
      emit: (citationEvent) => writer.send(createNormalizedMessage({
        kind: 'status', provider, sessionId, citationEvent,
      })),
    });
    let lastText: NormalizedMessage | undefined;
    let lastDelta: NormalizedMessage | undefined;
    let heldStreamEnd: NormalizedMessage | undefined;
    let interrupted = false;
    let completionReceived = false;
    let completion: Promise<void> | undefined;
    const flush = () => {
      const content = turn.flush();
      if (content && lastDelta) writer.send({ ...lastDelta, content });
    };
    const finish = () => {
      if (!completion) completion = (async () => {
        flush();
        const suffix = interrupted ? '' : await turn.finish();
        if (heldStreamEnd) {
          if (suffix && lastDelta) writer.send({ ...lastDelta, content: suffix });
          writer.send(heldStreamEnd);
        }
        if (lastText && (suffix || heldStreamEnd)) writer.send({ ...lastText, content: `${lastText.content ?? ''}${suffix}` });
      })();
      return completion;
    };
    const wrapped = new Proxy(writer, {
      get(target, key) {
        if (key !== 'send') {
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return (data: unknown) => {
          const message = data as NormalizedMessage;
          if (!message || typeof message.kind !== 'string') return target.send(data);
          if (message.parentToolUseId) return target.send(data);
          if (message.kind === 'text' && message.role === 'user') {
            target.send({ ...message, content: withoutCitationInstructions(message.content ?? '') });
            return;
          }
          turn.observe(message);
          if (message.kind === 'stream_delta') {
            lastDelta = message;
            const content = turn.delta(message.content ?? '');
            if (content) target.send({ ...message, content });
            return;
          }
          if (message.kind === 'stream_end') {
            flush();
            if (turn.hasCitations) { heldStreamEnd = message; return; }
          }
          if (message.kind === 'text' && message.role === 'assistant') {
            flush();
            lastText = { ...message, content: turn.text(message.content ?? '') };
            if (!heldStreamEnd) target.send(lastText);
            return;
          }
          if (message.kind === 'complete') {
            completionReceived = true;
            interrupted = message.aborted === true || (typeof message.exitCode === 'number' && message.exitCode !== 0);
            completion = finish().then(() => target.send(message));
            return;
          }
          target.send(message);
        };
      },
    }) as ProviderRuntimeWriter;
    try {
      return await run(provider, command.startsWith('/') ? command : withCitationInstructions(command), runtimeOptions, wrapped);
    } catch (error) {
      interrupted = true;
      throw error;
    } finally {
      if (!completionReceived) interrupted = true;
      await finish();
    }
  };
  options.runtime.getRunner = (provider) => (command, runtimeOptions, writer) =>
    options.runtime.run(provider, command, runtimeOptions, writer);

  options.sessions.fetchHistory = async (sessionId, pageOptions = {}) => {
    const details = options.sessions.getSessionDetailsById(sessionId);
    if (details.provider !== 'claude' && details.provider !== 'codex') return fetchHistory(sessionId, pageOptions);
    const history = await fetchHistory(sessionId, { limit: null, offset: 0 });
    const messages: NormalizedMessage[] = [];
    let lastTextIndex = -1;
    const makeTurn = () => createCitationTurn({
      cwd: details.project?.fullPath ?? '', sessionId, store: options.store, emit: () => {},
      recordVerification: false,
    });
    let turn = makeTurn();
    const finish = async () => {
      const suffix = await turn.finish();
      if (suffix && lastTextIndex >= 0) {
        const message = messages[lastTextIndex];
        messages[lastTextIndex] = { ...message, content: `${message.content ?? ''}${suffix}` };
      }
    };
    for (const message of history.messages) {
      if (message.kind === 'text' && message.role === 'user') {
        await finish();
        turn = makeTurn();
        lastTextIndex = -1;
      }
      turn.observe(message);
      if (message.kind === 'text' && message.role === 'assistant' && !message.parentToolUseId) {
        lastTextIndex = messages.length;
        messages.push({ ...message, content: turn.text(message.content ?? '') });
      } else if (message.kind === 'text' && message.role === 'user') {
        messages.push({ ...message, content: withoutCitationInstructions(message.content ?? '') });
      } else messages.push(message);
    }
    await finish();
    const offset = Math.max(0, pageOptions.offset ?? 0);
    const limit = pageOptions.limit ?? null;
    const end = Math.max(0, messages.length - offset);
    const start = limit === null ? 0 : Math.max(0, end - Math.max(0, limit));
    return { ...history, messages: messages.slice(start, end), offset, limit, hasMore: start > 0 };
  };

  return () => {
    options.runtime.run = run;
    options.runtime.getRunner = getRunner;
    options.sessions.fetchHistory = fetchHistory;
  };
}
