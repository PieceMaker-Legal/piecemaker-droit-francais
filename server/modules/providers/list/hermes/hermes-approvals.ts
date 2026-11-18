type ApprovalEntry = {
  resolver: (decision: unknown) => void;
  sessionId: string | null;
  provider: string | null;
  meta: Record<string, unknown>;
  receivedAt: unknown;
};

const pendingApprovals = new Map<string, ApprovalEntry>();
const APPROVAL_MAX_AGE_MS = 30 * 60 * 1000;

function sweepExpiredApprovals(now = Date.now()) {
  for (const [requestId, entry] of pendingApprovals) {
    const receivedAt = entry.receivedAt instanceof Date ? entry.receivedAt.getTime() : 0;
    if (receivedAt && now - receivedAt > APPROVAL_MAX_AGE_MS) {
      pendingApprovals.delete(requestId);
    }
  }
}

export function clearApprovalsForSession(sessionId: string) {
  if (!sessionId) {
    return;
  }
  for (const [requestId, entry] of pendingApprovals) {
    if (entry.sessionId === sessionId) {
      pendingApprovals.delete(requestId);
    }
  }
}

export function registerApproval(requestId: string, { resolver, sessionId = null, provider = null, meta = {} }: { resolver: ApprovalEntry["resolver"]; sessionId?: string | null; provider?: string | null; meta?: Record<string, unknown> }) {
  if (!requestId || typeof resolver !== 'function') {
    return;
  }

  sweepExpiredApprovals();

  pendingApprovals.set(requestId, {
    resolver,
    sessionId,
    provider,
    meta,
    receivedAt: meta.receivedAt || meta._receivedAt || new Date(),
  });
}

export function unregisterApproval(requestId: string) {
  pendingApprovals.delete(requestId);
}

export function resolveToolApproval(requestId: string, decision: unknown) {
  const entry = pendingApprovals.get(requestId);
  if (!entry) {
    return false;
  }

  entry.resolver(decision);
  return true;
}

export function getPendingApprovalsForSession(sessionId: string) {
  const pending = [];
  for (const [requestId, entry] of pendingApprovals.entries()) {
    if (entry.sessionId !== sessionId) {
      continue;
    }

    pending.push({
      requestId,
      toolName: entry.meta.toolName || entry.meta._toolName || 'UnknownTool',
      input: entry.meta.input ?? entry.meta._input,
      context: entry.meta.context ?? entry.meta._context,
      sessionId,
      provider: entry.provider,
      receivedAt: entry.receivedAt,
    });
  }

  return pending;
}
