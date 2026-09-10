import type { providerRuntimeService, sessionsService } from '@/modules/providers/index.js';
import type { NormalizedMessage } from '@/shared/types.js';

import type { createLibraryStore } from './store.js';

const OPEN = '<PIECEMAKER_LIBRARY_INSTRUCTIONS>';
const CLOSE = '</PIECEMAKER_LIBRARY_INSTRUCTIONS>';

export function stripLibraryInstructions(text: string) {
  const start = text.lastIndexOf(`\n\n${OPEN}\n`);
  return start >= 0 && text.endsWith(CLOSE) ? text.slice(0, start) : text;
}

export function installLibraryRuntime(runtime: Pick<typeof providerRuntimeService, 'run' | 'getRunner'>, sessions: Pick<typeof sessionsService, 'fetchHistory'>, store: ReturnType<typeof createLibraryStore>) {
  const run = runtime.run.bind(runtime);
  const history = sessions.fetchHistory.bind(sessions);
  runtime.run = async (provider, command, options, writer) => {
    const cwd = String(options.cwd ?? options.projectPath ?? '');
    const instructions = cwd ? store.instructions(cwd) : '';
    const wrapped = new Proxy(writer, {
      get(target, key) {
        if (key === 'send') return (value: unknown) => {
          const message = value as NormalizedMessage;
          target.send(message?.kind === 'text' && message.role === 'user'
            ? { ...message, content: stripLibraryInstructions(message.content ?? '') } : value);
        };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return run(provider, instructions ? `${command}\n\n${OPEN}\nInstructions activées pour ce dossier, à appliquer lorsqu’elles concernent la demande.\n${instructions}\n${CLOSE}` : command, options, wrapped);
  };
  runtime.getRunner = (provider) => (command, options, writer) => runtime.run(provider, command, options, writer);
  sessions.fetchHistory = async (...args) => {
    const result = await history(...args);
    return { ...result, messages: result.messages.map((message) => message.kind === 'text' && message.role === 'user'
      ? { ...message, content: stripLibraryInstructions(message.content ?? '') } : message) };
  };
}
