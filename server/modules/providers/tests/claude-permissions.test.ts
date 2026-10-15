import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import { queryClaudeSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { ProviderRuntimeContext } from '@/shared/types.js';

const SESSION_ID = 'app-permission-session';
const NATIVE_ID = 'native-permission-session';

async function capturedSdkOptions(runOptions: Record<string, unknown>): Promise<Record<string, unknown>> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-permissions-'));
  let captured: Record<string, unknown> | undefined;
  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt, options }) => {
    captured = options;
    void (async () => {
      for await (const _message of prompt) { /* drain held stdin */ }
    })();
    const iterator = (async function* () {
      yield { type: 'system', subtype: 'init', session_id: NATIVE_ID };
      yield { type: 'result', subtype: 'success', session_id: NATIVE_ID, result: 'ok', duration_ms: 1, num_turns: 1 };
    })();
    return Object.assign(iterator, {
      interrupt: async () => {},
      stopTask: async () => {},
    });
  };
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    createQuery,
  };
  const writer = { send() {}, userId: null };
  try {
    await queryClaudeSDK('hello', { sessionId: SESSION_ID, cwd, ...runOptions }, writer as never, context);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
  assert.ok(captured, 'expected the Claude SDK query to start');
  return captured;
}

test('Contourner les permissions Claude passe permissionMode au SDK', async () => {
  const options = await capturedSdkOptions({ permissionMode: 'bypassPermissions' });
  assert.equal(options.permissionMode, 'bypassPermissions');
});

test('Réglages Claude skipPermissions force bypassPermissions sauf en plan', async () => {
  const bypass = await capturedSdkOptions({
    permissionMode: 'default',
    toolsSettings: { skipPermissions: true, allowedTools: [], disallowedTools: [] },
  });
  assert.equal(bypass.permissionMode, 'bypassPermissions');
  const plan = await capturedSdkOptions({
    permissionMode: 'plan',
    toolsSettings: { skipPermissions: true, allowedTools: [], disallowedTools: [] },
  });
  assert.equal(plan.permissionMode, 'plan');
});
