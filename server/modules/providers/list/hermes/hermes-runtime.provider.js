import crypto from 'node:crypto';

import { hermesConnectionManager } from '@/modules/providers/list/hermes/hermes-acp-client.js';
import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';
import {
  clearApprovalsForSession,
  getPendingApprovalsForSession,
  registerApproval,
  resolveToolApproval,
  unregisterApproval,
} from '@/modules/providers/list/hermes/hermes-approvals.js';

const PROVIDER = 'hermes';
const HERMES_CONFIGURED_MODEL = '__hermes_configured_model__';
const activeHermesSessions = new Map();
// Session ids whose run was aborted; the terminal `complete` is emitted by
// handleChatAbort, so the runtime must not also emit a "completed" one.
const abortedSessionIds = new Set();

function createRequestId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function readSessionId(result) {
  if (!result || typeof result !== 'object') {
    return null;
  }
  return result.sessionId
    || result.session_id
    || result.id
    || result.session?.id
    || result.session?.sessionId
    || result.session?.session_id
    || null;
}

function readStopReason(result) {
  if (!result || typeof result !== 'object') {
    return null;
  }
  return result.stopReason || result.stop_reason || result.reason || null;
}

function buildPromptParams(sessionId, command) {
  return {
    sessionId,
    prompt: [{ type: 'text', text: command }],
  };
}

function buildSessionSetupParams(sessionId, workingDir) {
  return {
    ...(sessionId ? { sessionId } : {}),
    cwd: workingDir,
    mcpServers: [],
  };
}

function canLoadSession(connection) {
  return connection?.initializeResult?.agentCapabilities?.loadSession === true;
}

function findPermissionOption(options, kinds, fallbackOptionIds = []) {
  if (!Array.isArray(options)) {
    return null;
  }

  for (const kind of kinds) {
    const match = options.find((option) => option?.kind === kind);
    if (match?.optionId) {
      return match.optionId;
    }
  }

  for (const optionId of fallbackOptionIds) {
    const match = options.find((option) => option?.optionId === optionId);
    if (match?.optionId) {
      return match.optionId;
    }
  }

  return null;
}

function createPermissionDecision(decision, options = []) {
  if (!decision) {
    return { outcome: { outcome: 'cancelled' } };
  }

  if (decision.cancelled) {
    return { outcome: { outcome: 'cancelled' } };
  }

  if (decision.allow) {
    const optionId = decision.rememberEntry
      ? findPermissionOption(options, ['allow_always', 'allow_session'], ['allow_always', 'allow_session'])
      : findPermissionOption(options, ['allow_once'], ['allow_once']);

    if (!optionId) {
      return { outcome: { outcome: 'cancelled' } };
    }

    return {
      outcome: {
        outcome: 'selected',
        optionId,
      },
    };
  }

  const denyOptionId = findPermissionOption(options, ['reject_once', 'deny', 'reject_always'], ['deny', 'reject_once', 'reject_always']);
  if (denyOptionId) {
    return {
      outcome: {
        outcome: 'selected',
        optionId: denyOptionId,
      },
    };
  }

  return {
    outcome: { outcome: 'cancelled' },
  };
}

async function waitForPermission(ws, params, capturedSessionId, sessionSummary) {
  const requestId = createRequestId();
  const toolCall = params?.toolCall || params?.tool_call || {};
  const toolName = params?.toolName
    || params?.tool_name
    || params?.name
    || params?.tool?.name
    || toolCall.title
    || 'HermesTool';
  const input = params?.input
    ?? params?.arguments
    ?? params?.toolInput
    ?? params?.tool_input
    ?? toolCall.rawInput
    ?? toolCall.raw_input
    ?? toolCall;

  ws.send(createNormalizedMessage({
    kind: 'permission_request',
    requestId,
    toolName,
    input,
    sessionId: capturedSessionId,
    provider: PROVIDER,
  }));

  return new Promise((resolve) => {
    registerApproval(requestId, {
      sessionId: capturedSessionId,
      provider: PROVIDER,
      meta: {
        toolName,
        input,
        context: params,
        sessionName: sessionSummary,
        receivedAt: new Date(),
      },
      resolver: (decision) => {
        unregisterApproval(requestId);
        resolve(createPermissionDecision(decision, params?.options));
      },
    });
  });
}

async function spawnHermes(command, options = {}, ws, context) {
  const { sessionId, projectPath, cwd, model, sessionSummary } = options;
  const workingDir = cwd || projectPath || process.cwd();
  const requestedModel = model === HERMES_CONFIGURED_MODEL ? undefined : model;
  const providerSessionId = context.resolveProviderSessionId(sessionId);
  let capturedSessionId = providerSessionId || null;
  let sessionCreatedSent = false;
  let completeSent = false;
  const appSessionKey = sessionId || null;
  let activeKey = appSessionKey || capturedSessionId || `pending-${createRequestId()}`;

  const notifyTerminalState = ({ error = null, stopReason = 'completed' } = {}) => {
    const finalSessionId = sessionId || capturedSessionId || activeKey;
    if (!error) {
      notifyRunStopped({
        userId: ws?.userId || null,
        provider: PROVIDER,
        sessionId: finalSessionId,
        sessionName: sessionSummary,
        stopReason,
      });
      return;
    }

    notifyRunFailed({
      userId: ws?.userId || null,
      provider: PROVIDER,
      sessionId: finalSessionId,
      sessionName: sessionSummary,
      error,
    });
  };

  const registerSession = (nextSessionId, connection) => {
    if (!nextSessionId || capturedSessionId === nextSessionId) {
      return;
    }

    capturedSessionId = nextSessionId;
    if (!appSessionKey) {
      activeHermesSessions.delete(activeKey);
      activeKey = nextSessionId;
    }
    activeHermesSessions.set(activeKey, {
      connection,
      sessionId: capturedSessionId,
      status: 'active',
      aborted: false,
      ws,
      sessionSummary,
    });

    if (ws.setSessionId && typeof ws.setSessionId === 'function') {
      ws.setSessionId(capturedSessionId);
    }

    if (!providerSessionId && !sessionCreatedSent) {
      sessionCreatedSent = true;
      ws.send(createNormalizedMessage({
        kind: 'session_created',
        newSessionId: capturedSessionId,
        sessionId: capturedSessionId,
        provider: PROVIDER,
      }));
    }
  };

  try {
    await context.resolveResumeModel(sessionId, requestedModel);
    const connection = await hermesConnectionManager.getConnection(workingDir);
    activeHermesSessions.set(activeKey, {
      connection,
      sessionId: capturedSessionId,
      status: 'active',
      aborted: false,
      ws,
      sessionSummary,
    });

    const unregisterPermissionHandler = connection.registerRequestHandler('session/request_permission', (params) => {
      const permissionSessionId = params?.sessionId || params?.session_id || null;
      const active = !permissionSessionId || permissionSessionId === capturedSessionId
        ? activeHermesSessions.get(activeKey)
        : null;
      if (!active) {
        return { outcome: { outcome: 'cancelled' } };
      }

      return waitForPermission(
        active.ws,
        params,
        appSessionKey || active.sessionId || permissionSessionId || capturedSessionId,
        active.sessionSummary || sessionSummary,
      );
    });

    const updateHandler = (params) => {
      const updateSessionId = params?.sessionId || params?.session_id || null;
      if (capturedSessionId && updateSessionId && updateSessionId !== capturedSessionId) {
        return;
      }

      registerSession(updateSessionId, connection);
      const normalized = context.normalizeMessage(params, capturedSessionId || updateSessionId || null);
      for (const msg of normalized) {
        ws.send(msg);
      }
    };

    connection.on('session/update', updateHandler);

    try {
      let sessionResult;
      if (providerSessionId && canLoadSession(connection)) {
        try {
          sessionResult = await connection.request('session/load', buildSessionSetupParams(providerSessionId, workingDir));
        } catch {
          sessionResult = { sessionId: providerSessionId };
        }
      } else {
        sessionResult = await connection.request('session/new', buildSessionSetupParams(null, workingDir));
      }

      registerSession(readSessionId(sessionResult) || providerSessionId, connection);
      if (!capturedSessionId) {
        throw new Error('Hermes ACP did not return a session id.');
      }
      const promptResult = await connection.request('session/prompt', buildPromptParams(capturedSessionId, command));
      const finalSessionId = sessionId || capturedSessionId || readSessionId(promptResult) || activeKey;
      const stopReason = readStopReason(promptResult) || 'completed';
      const active = activeHermesSessions.get(activeKey);

      if (promptResult?.usage || promptResult?.tokenUsage || promptResult?.token_usage) {
        ws.send(createNormalizedMessage({
          kind: 'status',
          text: 'token_budget',
          tokenBudget: promptResult.usage || promptResult.tokenUsage || promptResult.token_usage,
          sessionId: finalSessionId,
          provider: PROVIDER,
        }));
      }

      const abortedById = abortedSessionIds.delete(finalSessionId);
      const abortedByKey = abortedSessionIds.delete(activeKey);
      const wasAborted = Boolean(active?.aborted || abortedById || abortedByKey);

      if (!completeSent && !wasAborted) {
        completeSent = true;
        ws.send(createCompleteMessage({ provider: PROVIDER, sessionId: finalSessionId, exitCode: 0 }));
      }
      activeHermesSessions.delete(finalSessionId);
      activeHermesSessions.delete(activeKey);
      clearApprovalsForSession(appSessionKey || capturedSessionId);
      notifyTerminalState({ stopReason: wasAborted ? 'aborted' : stopReason });
    } finally {
      connection.off('session/update', updateHandler);
      unregisterPermissionHandler();
    }
  } catch (error) {
    const finalSessionId = sessionId || capturedSessionId || activeKey;
    const abortedById = abortedSessionIds.delete(finalSessionId);
    const abortedByKey = abortedSessionIds.delete(activeKey);
    activeHermesSessions.delete(finalSessionId);
    activeHermesSessions.delete(activeKey);
    clearApprovalsForSession(appSessionKey || capturedSessionId);

    // A cancelled session/prompt rejects here; its aborted terminal `complete`
    // is sent by handleChatAbort, so don't surface the cancellation as an error.
    if (abortedById || abortedByKey) {
      return;
    }

    const installed = await context.isProviderInstalled();
    const errorContent = !installed
      ? 'Hermes ACP is not installed. Install Hermes and ensure hermes-acp is on PATH.'
      : error instanceof Error ? error.message : String(error);

    ws.send(createNormalizedMessage({
      kind: 'error',
      content: errorContent,
      sessionId: finalSessionId,
      provider: PROVIDER,
    }));
    if (!completeSent) {
      completeSent = true;
      ws.send(createCompleteMessage({ provider: PROVIDER, sessionId: finalSessionId, exitCode: 1 }));
    }
    notifyTerminalState({ error });
    throw error;
  }
}

async function abortHermesSession(providerSessionId) {
  const active = activeHermesSessions.get(providerSessionId);
  if (!active) {
    return false;
  }

  active.aborted = true;
  active.status = 'aborted';
  abortedSessionIds.add(providerSessionId);
  if (active.sessionId) {
    abortedSessionIds.add(active.sessionId);
  }
  for (const approval of getPendingApprovalsForSession(providerSessionId)) {
    resolveToolApproval(approval.requestId, { cancelled: true });
  }

  try {
    active.connection.notify('session/cancel', { sessionId: active.sessionId || providerSessionId });
  } catch {
    // If Hermes already finished, the caller still sees the run as aborted.
  }
  activeHermesSessions.delete(providerSessionId);
  return true;
}

function isHermesSessionActive(sessionId) {
  return activeHermesSessions.has(sessionId);
}

function getActiveHermesSessions() {
  return Array.from(activeHermesSessions.keys());
}

export const hermesRuntime = {
  run: spawnHermes,
  abort: abortHermesSession,
  permissions: {
    resolve: resolveToolApproval,
    listPending: getPendingApprovalsForSession,
  },
};

export {
  spawnHermes,
  abortHermesSession,
  isHermesSessionActive,
  getActiveHermesSessions,
  createPermissionDecision,
};
