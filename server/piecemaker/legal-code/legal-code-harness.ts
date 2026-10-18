import fs from 'node:fs';
import path from 'node:path';

import type { providerRuntimeService, sessionsService } from '@/modules/providers/index.js';
import type { NormalizedMessage, ProviderRuntimeWriter } from '@/shared/types.js';

const OPEN = '<LEGAL_CODE_INSTRUCTION>';
const CLOSE = '</LEGAL_CODE_INSTRUCTION>';

export function withLegalCodeInstructions(command: string, instructions: string) {
  return `${command}\n\n${OPEN}\n${instructions.trim()}\n${CLOSE}`;
}

export function withoutLegalCodeInstructions(command: string) {
  if (!command.endsWith(CLOSE)) return command;
  const start = command.lastIndexOf(`\n\n${OPEN}\n`);
  return start < 0 ? command : command.slice(0, start);
}

const stripUserText = (message: NormalizedMessage) =>
  message?.kind === 'text' && message.role === 'user'
    ? { ...message, content: withoutLegalCodeInstructions(message.content ?? '') }
    : message;

export function installLegalCodeHarness(options: {
  runtime: Pick<typeof providerRuntimeService, 'run'>;
  sessions: Pick<typeof sessionsService, 'fetchHistory'>;
  applicationRoot: string;
}) {
  const run = options.runtime.run.bind(options.runtime);
  const fetchHistory = options.sessions.fetchHistory.bind(options.sessions);
  const instructionsPath = path.join(options.applicationRoot, 'server', 'piecemaker', 'legal-code', 'instructions.md');

  options.runtime.run = async (provider, command, runtimeOptions, writer) => {
    if (runtimeOptions.legalCode !== true || command.startsWith('/')) return run(provider, command, runtimeOptions, writer);
    const wrapped = new Proxy(writer, {
      get(target, key) {
        if (key !== 'send') {
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return (data: unknown) => target.send(stripUserText(data as NormalizedMessage));
      },
    }) as ProviderRuntimeWriter;
    const dossier = String(runtimeOptions.cwd ?? runtimeOptions.projectPath ?? '');
    const instructions = `${fs.readFileSync(instructionsPath, 'utf8').trim()}\n\nDossier de la session : ${dossier}. Passe toujours --dossier "${dossier}" à pm, quel que soit le répertoire courant.`;
    return run(provider, withLegalCodeInstructions(command, instructions), runtimeOptions, wrapped);
  };

  options.sessions.fetchHistory = async (sessionId, pageOptions) => {
    const history = await fetchHistory(sessionId, pageOptions);
    return { ...history, messages: history.messages.map(stripUserText) };
  };

  return () => {
    options.runtime.run = run;
    options.sessions.fetchHistory = fetchHistory;
  };
}
