import crossSpawn from 'cross-spawn';

import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import type { IProviderRuntime } from '@/shared/interfaces.js';
import type { AnyRecord, ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/types.js';
import { createCompleteMessage, createNormalizedMessage, flattenPromptForWindowsShell } from '@/shared/utils.js';

// cross-spawn resolves .cmd shims/PATHEXT on Windows and delegates to
// child_process.spawn everywhere else.
const spawnFunction = crossSpawn;

const activeMistralProcesses = new Map<string, ReturnType<typeof spawnFunction> & { aborted?: boolean; sessionId?: string }>();

type RunNotificationInput = {
  userId: string | number | null;
  provider: string;
  sessionId?: string | null;
  sessionName?: string | null;
  stopReason?: string;
  error?: unknown;
};

// The notification orchestrator remains a JavaScript module. Its inferred
// default-parameter types are narrower than its runtime contract, so expose
// the actual provider-facing shape at this TypeScript boundary.
const notifyRunStoppedForProvider = notifyRunStopped as unknown as (input: RunNotificationInput) => void;
const notifyRunFailedForProvider = notifyRunFailed as unknown as (input: RunNotificationInput) => void;

/**
 * Maps the UI permission mode onto Vibe's `--agent` presets.
 *
 * Vibe ships four builtin agents (verified via `vibe --help`): `ask` (prompts
 * for every tool call), `plan` (read-only), `accept-edits` (auto-approves file
 * edits), and `auto-approve` (approves everything). There is no separate
 * bypass flag beyond `--auto-approve`/`--yolo`, which this maps onto directly
 * for the `bypassPermissions` mode so the process never blocks waiting on a
 * prompt it cannot answer non-interactively.
 */
function resolveMistralPermissionOptions(permissionMode: string | undefined): { args: string[] } {
  switch (permissionMode) {
    case 'plan':
      return { args: ['--agent', 'plan'] };
    case 'bypassPermissions':
      return { args: ['--auto-approve'] };
    case 'acceptEdits':
      return { args: ['--agent', 'accept-edits'] };
    default:
      return { args: ['--agent', 'ask', '--auto-approve'] };
  }
}

function resolveMistralEffort(
  model: string | undefined,
  effort: string | undefined,
  modelsDefinition: { OPTIONS?: { value: string; effort?: { values?: { value: string }[] } }[] } | null | undefined,
): string | undefined {
  const selectedModel = modelsDefinition?.OPTIONS?.find((option) => option.value === model);
  const allowedEfforts = selectedModel?.effort?.values?.map((value) => value.value) || [];
  return typeof effort === 'string' && effort !== 'default' && allowedEfforts.includes(effort)
    ? effort
    : undefined;
}

export class MistralProviderRuntime implements IProviderRuntime {
  /**
   * Checks whether the Vibe CLI (`vibe`) is available on this host.
   *
   * Note: Vibe is the conversational/coding-agent binary that actually runs
   * chat turns. It is distinct from the `mistral` CLI, which only manages
   * account identity (`mistral login`/`whoami`) and has no chat runtime of
   * its own.
   */
  private checkInstalled(): boolean {
    try {
      const result = crossSpawn.sync('vibe', ['--version'], { stdio: 'ignore', timeout: 5000 });
      return !result.error && result.status === 0;
    } catch {
      return false;
    }
  }

  async run(
    command: string,
    options: AnyRecord,
    writer: ProviderRuntimeWriter,
    context: ProviderRuntimeContext,
  ): Promise<unknown> {
    return spawnVibe(command, options, writer, context, () => this.checkInstalled());
  }

  async abort(sessionId: string): Promise<boolean> {
    return abortMistralSession(sessionId);
  }
}

/**
 * Executes one Vibe CLI turn in programmatic streaming mode.
 *
 * Command shape (confirmed via `vibe --help` and a live run):
 *   vibe -p "<prompt>" --output streaming --trust [--resume <id> | --continue]
 *        [--workdir <dir>] [--agent <name>] [--auto-approve]
 *        [--max-turns N] [--max-price DOLLARS] [--max-tokens N]
 *
 * `--output streaming` emits one newline-delimited JSON object per message,
 * shaped like:
 *   { id, sessionId, turnId, createdAt, updatedAt, generationStatus,
 *     type: 'message', role, content: [{ type: 'text', text } | ...], source }
 *
 * Vibe has no SDK; every run is a CLI subprocess, and there is no separate
 * MCP/session-service layer to configure beyond the CLI's own `~/.vibe`
 * config and `vibe mcp` commands (out of scope for this first implementation).
 */
async function spawnVibe(
  command: string,
  options: AnyRecord,
  ws: ProviderRuntimeWriter,
  context: ProviderRuntimeContext,
  isInstalledSync: () => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const {
      sessionId,
      projectPath,
      cwd,
      model,
      effort,
      sessionSummary,
      permissionMode,
      maxTurns,
      maxPrice,
      maxTokens,
    } = options as {
      sessionId?: string;
      projectPath?: string;
      cwd?: string;
      model?: string;
      effort?: string;
      sessionSummary?: string;
      permissionMode?: string;
      maxTurns?: number;
      maxPrice?: number;
      maxTokens?: number;
    };

    // Callers pass the stable app session id; Vibe resumes with the
    // provider-native session id recorded on the session row.
    const providerSessionId = context.resolveProviderSessionId(sessionId);
    const workingDir = cwd || projectPath || process.cwd();
    // Process-map key: the app session id when the caller supplied one, so
    // abort-by-app-id always works even before Vibe reports its own id.
    const processKey = sessionId || Date.now().toString();
    let capturedSessionId = providerSessionId;
    let sessionCreatedSent = false;
    let stdoutLineBuffer = '';
    let terminalNotificationSent = false;
    let vibeProcess: (ReturnType<typeof spawnFunction> & { aborted?: boolean; sessionId?: string }) | null = null;
    // Unified lifecycle contract: exactly one terminal `complete` per run
    // (close and error handlers can both fire for spawn failures).
    let completeSent = false;

    const notifyTerminalState = ({ code = null, error = null }: { code?: number | null; error?: unknown } = {}) => {
      if (terminalNotificationSent) {
        return;
      }
      terminalNotificationSent = true;
      const finalSessionId = sessionId || capturedSessionId || processKey;

      if (code === 0 && !error) {
        notifyRunStoppedForProvider({
          userId: ws?.userId || null,
          provider: 'mistral',
          sessionId: finalSessionId,
          sessionName: sessionSummary,
          stopReason: 'completed',
        });
        return;
      }

      notifyRunFailedForProvider({
        userId: ws?.userId || null,
        provider: 'mistral',
        sessionId: finalSessionId,
        sessionName: sessionSummary,
        error: error || `Vibe CLI exited with code ${code}`,
      });
    };

    const registerSession = (nextSessionId: string | null | undefined) => {
      if (!nextSessionId || capturedSessionId === nextSessionId) {
        return;
      }

      capturedSessionId = nextSessionId;
      // Legacy/direct callers without an app session id re-key the process
      // under the provider-native id once it is known.
      if (!sessionId && processKey !== capturedSessionId && vibeProcess) {
        activeMistralProcesses.delete(processKey);
        activeMistralProcesses.set(capturedSessionId, vibeProcess);
      }
      if (vibeProcess) {
        vibeProcess.sessionId = capturedSessionId;
      }

      if (ws.setSessionId && typeof ws.setSessionId === 'function') {
        ws.setSessionId(capturedSessionId);
      }

      if (!providerSessionId && !sessionCreatedSent) {
        sessionCreatedSent = true;
        ws.send(createNormalizedMessage({
          kind: 'session_created',
          newSessionId: capturedSessionId,
          sessionId: capturedSessionId,
          provider: 'mistral',
        }));
      }
    };

    const processVibeOutputLine = (line: string) => {
      if (!line || !line.trim()) {
        return;
      }

      let response: unknown;
      try {
        response = JSON.parse(line);
      } catch {
        // Vibe's text-mode fallback (or stray non-JSON stdout) — surface it
        // as a raw delta rather than dropping it silently.
        ws.send(createNormalizedMessage({
          kind: 'stream_delta',
          content: line,
          sessionId: capturedSessionId || sessionId || null,
          provider: 'mistral',
        }));
        return;
      }

      try {
        const record = response as { sessionId?: string } | null;
        registerSession(record?.sessionId ?? null);
        const normalized = context.normalizeMessage(response, capturedSessionId || sessionId || null);
        for (const msg of normalized) {
          ws.send(msg);
        }
      } catch (error) {
        const errorContent = error instanceof Error ? error.message : String(error);
        console.error('[Mistral] Failed to process JSON output:', errorContent);
        ws.send(createNormalizedMessage({
          kind: 'error',
          content: errorContent,
          sessionId: capturedSessionId || sessionId || null,
          provider: 'mistral',
        }));
      }
    };

    void context.resolveResumeModel(sessionId, model).then(async (resolvedModel) => {
      let effortModels = null;
      try {
        effortModels = await context.getProviderModels();
      } catch (error) {
        console.warn('[Mistral] Unable to load provider models for effort validation:', error);
      }

      const resolvedEffort = resolveMistralEffort(resolvedModel, effort, effortModels);
      const permissionOptions = resolveMistralPermissionOptions(permissionMode);

      const args: string[] = ['--output', 'streaming', '--trust'];

      if (providerSessionId) {
        args.push('--resume', providerSessionId);
      }

      args.push('--workdir', workingDir);
      args.push(...permissionOptions.args);

      if (resolvedModel) {
        // Vibe resolves the active model from its own config/profile system
        // rather than a CLI flag; VIBE_ACTIVE_MODEL is the documented env-var
        // override (see `vibe --help`, "Environment variables").
      }

      if (typeof maxTurns === 'number' && Number.isFinite(maxTurns)) {
        args.push('--max-turns', String(maxTurns));
      }
      if (typeof maxPrice === 'number' && Number.isFinite(maxPrice)) {
        args.push('--max-price', String(maxPrice));
      }
      if (typeof maxTokens === 'number' && Number.isFinite(maxTokens)) {
        args.push('--max-tokens', String(maxTokens));
      }

      const promptText = flattenPromptForWindowsShell(command?.trim() || '');
      // `-p` takes the prompt as its own value; Vibe also accepts it as a
      // trailing positional, but the explicit flag form is unambiguous.
      args.push('-p', promptText);

      const env: NodeJS.ProcessEnv = { ...process.env };
      if (resolvedModel) {
        env.VIBE_ACTIVE_MODEL = resolvedModel;
      }
      if (resolvedEffort) {
        env.VIBE_EFFORT = resolvedEffort;
      }

      vibeProcess = spawnFunction('vibe', args, {
        cwd: workingDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      });

      activeMistralProcesses.set(processKey, vibeProcess);
      vibeProcess.sessionId = processKey;

      vibeProcess.stdout?.on('data', (data: Buffer) => {
        stdoutLineBuffer += data.toString();
        const completeLines = stdoutLineBuffer.split(/\r?\n/);
        stdoutLineBuffer = completeLines.pop() || '';

        completeLines.forEach((line) => {
          processVibeOutputLine(line.trim());
        });
      });

      let stderrBuffer = '';
      vibeProcess.stderr?.on('data', (data: Buffer) => {
        stderrBuffer += data.toString();
      });

      vibeProcess.on('close', async (code) => {
        const finalSessionId = sessionId || capturedSessionId || processKey;
        activeMistralProcesses.delete(finalSessionId);
        activeMistralProcesses.delete(processKey);

        if (stdoutLineBuffer.trim()) {
          processVibeOutputLine(stdoutLineBuffer.trim());
          stdoutLineBuffer = '';
        }

        if (code === 0) {
          if (!completeSent && !vibeProcess?.aborted) {
            completeSent = true;
            ws.send(createCompleteMessage({ provider: 'mistral', sessionId: finalSessionId, exitCode: code }));
          }
          notifyTerminalState({ code });
          resolve();
          return;
        }

        // Non-zero exit: surface stderr (Vibe writes API/auth/payment errors
        // there — e.g. 402 Payment Required — as plain text, not JSON).
        if (!vibeProcess?.aborted) {
          const installed = code === 127 || code === null ? isInstalledSync() : true;
          const errorContent = !installed
            ? 'Mistral Vibe CLI is not installed. Install it with: curl -LsSf https://mistral.ai/vibe/install.sh | bash'
            : (stderrBuffer.trim() || `Vibe CLI exited with code ${code}`);

          ws.send(createNormalizedMessage({
            kind: 'error',
            content: errorContent,
            sessionId: capturedSessionId || sessionId || null,
            provider: 'mistral',
          }));

          if (!completeSent) {
            completeSent = true;
            ws.send(createCompleteMessage({ provider: 'mistral', sessionId: finalSessionId, exitCode: code ?? 1 }));
          }
        }

        notifyTerminalState({ code });
        reject(new Error(code === null ? 'Vibe CLI process was terminated' : `Vibe CLI exited with code ${code}`));
      });

      vibeProcess.on('error', async (error) => {
        const finalSessionId = sessionId || capturedSessionId || processKey;
        activeMistralProcesses.delete(finalSessionId);
        activeMistralProcesses.delete(processKey);

        const installed = isInstalledSync();
        const errorContent = !installed
          ? 'Mistral Vibe CLI is not installed. Install it with: curl -LsSf https://mistral.ai/vibe/install.sh | bash'
          : error.message;

        ws.send(createNormalizedMessage({
          kind: 'error',
          content: errorContent,
          sessionId: finalSessionId,
          provider: 'mistral',
        }));
        if (!completeSent && !vibeProcess?.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'mistral', sessionId: finalSessionId, exitCode: 1 }));
        }
        notifyTerminalState({ error });
        reject(error);
      });
    }).catch(reject);
  });
}

function abortMistralSession(sessionId: string): boolean {
  const proc = activeMistralProcesses.get(sessionId);
  if (!proc) {
    return false;
  }

  // The abort handler sends the terminal complete (aborted: true); flag the
  // process so its close handler does not emit a second one.
  proc.aborted = true;
  proc.kill('SIGTERM');
  activeMistralProcesses.delete(sessionId);
  return true;
}

export const mistralRuntime = new MistralProviderRuntime();
