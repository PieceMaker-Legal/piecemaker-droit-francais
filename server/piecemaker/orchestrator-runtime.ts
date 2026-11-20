import type { createOrchestratorService } from '@/modules/piecemaker-orchestrateur/index.js';
import type { providerRuntimeService, sessionsService } from '@/modules/providers/index.js';
import { normalizeAttachmentDescriptors } from '@/shared/image-attachments.js';
import { createCompleteMessage, sliceTailPage } from '@/shared/utils.js';

type Orchestrator = ReturnType<typeof createOrchestratorService>;

export function installOrchestratorRuntime(
  runtime: Pick<typeof providerRuntimeService, 'run' | 'getRunner'>,
  sessions: Pick<typeof sessionsService, 'fetchHistory'>,
  orchestrator: Pick<Orchestrator, 'sessionId' | 'chatHistory'> & { postUserMessage(...args: Parameters<Orchestrator['postUserMessage']>): void },
  projectOf: (sessionId: string) => string | null,
) {
  const run = runtime.run.bind(runtime);
  const history = sessions.fetchHistory.bind(sessions);
  runtime.run = async (provider, command, options, writer) => {
    const sessionId = typeof options.sessionId === 'string' ? options.sessionId : '';
    const root = sessionId && projectOf(sessionId);
    if (!root || orchestrator.sessionId(root) !== sessionId) return run(provider, command, options, writer);
    const id = Number(writer.userId);
    orchestrator.postUserMessage(root, command, Number.isSafeInteger(id) && id > 0 ? id : null, normalizeAttachmentDescriptors(options.attachments));
    writer.send(createCompleteMessage({ provider, sessionId, exitCode: 0 }));
  };
  runtime.getRunner = (provider) => (command, options, writer) => runtime.run(provider, command, options, writer);
  sessions.fetchHistory = async (sessionId, options = {}) => {
    const root = projectOf(sessionId);
    const messages = root && await orchestrator.chatHistory(root, sessionId);
    if (!messages) return history(sessionId, options);
    const limit = options.limit ?? null;
    const offset = options.offset ?? 0;
    const { page, hasMore } = sliceTailPage(messages, limit, offset);
    return { messages: page, total: messages.length, hasMore, offset, limit };
  };
}
