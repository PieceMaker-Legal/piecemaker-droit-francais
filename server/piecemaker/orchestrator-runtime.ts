import type { providerRuntimeService, sessionsService } from '@/modules/providers/index.js';
import { wakeDisplay } from '@/modules/piecemaker-orchestrateur/index.js';
import type { RunnableProvider } from '@/modules/piecemaker-orchestrateur/index.js';

type TurnOptions = { model: string; provider: RunnableProvider; permissionMode: string; allowedTools: string[]; disallowedTools: string[] };
type TurnResult = { started: boolean; error: string | null };
type Orchestrator = {
  isOrchestratorSession(sessionId: string): boolean;
  composerTurn(root: string, sessionId: string, text: string, userId: number | null, runner: (content: string, options: TurnOptions) => Promise<TurnResult>): Promise<boolean>;
};
type RuntimeOptions = (userId: number | null, options: TurnOptions) => Record<string, unknown>;

export function installOrchestratorRuntime(
  runtime: Pick<typeof providerRuntimeService, 'run' | 'getRunner'>,
  sessions: Pick<typeof sessionsService, 'fetchHistory'>,
  orchestrator: Orchestrator,
  runtimeOptions: RuntimeOptions,
) {
  const run = runtime.run.bind(runtime);
  const history = sessions.fetchHistory.bind(sessions);
  runtime.run = async (provider, command, options, writer) => {
    const sessionId = typeof options.sessionId === 'string' ? options.sessionId : '';
    const root = String(options.projectPath ?? options.cwd ?? '');
    if (options.piecemakerOrchestrator || !sessionId || !root || !orchestrator.isOrchestratorSession(sessionId)) return run(provider, command, options, writer);
    let result: unknown;
    let failure: unknown = null;
    const id = Number(writer.userId);
    const userId = Number.isSafeInteger(id) && id > 0 ? id : null;
    const handled = await orchestrator.composerTurn(root, sessionId, command, userId, async (content, turn) => {
      try {
        const overrides = runtimeOptions(userId, turn);
        const toolsSettings = { ...options.toolsSettings as Record<string, unknown> | undefined, ...overrides.toolsSettings as Record<string, unknown> };
        result = await run(provider, content, { ...options, ...overrides, model: options.model ?? turn.model, toolsSettings }, writer);
        return { started: true, error: null };
      } catch (error) {
        failure = error;
        return { started: true, error: error instanceof Error ? error.message : String(error) };
      }
    });
    if (failure) throw failure;
    return handled ? result as Awaited<ReturnType<typeof run>> : run(provider, command, options, writer);
  };
  runtime.getRunner = (provider) => (command, options, writer) => runtime.run(provider, command, options, writer);
  sessions.fetchHistory = async (...args) => {
    const result = await history(...args);
    return { ...result, messages: result.messages.map((message) => {
      const display = message.kind === 'text' && message.role === 'user' ? wakeDisplay(message.content ?? '') : null;
      return display === null ? message : { ...message, content: display };
    }) };
  };
}
