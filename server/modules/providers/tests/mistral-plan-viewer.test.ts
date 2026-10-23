import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { isVibePlanMessage } from '@/modules/providers/list/mistral/mistral-plan-messages.js';
import { mistralRuntime } from '@/modules/providers/list/mistral/mistral-runtime.provider.js';
import { MistralSessionsProvider } from '@/modules/providers/list/mistral/mistral-sessions.provider.js';
import type { ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/index.js';
import type { NormalizedMessage } from '@/shared/types.js';

const sessionId = 'native-plan-example';
const finalResponse = {
  sessionId, id: 'final-plan', turnId: 'turn-example', type: 'message', role: 'assistant',
  createdAt: Date.UTC(2026, 0, 1), content: [{ type: 'text', text: '# Plan\n\n1. Lire le document fictif.\n2. Proposer les corrections.' }],
};

async function runPlan(t: test.TestContext, prompt: string, permissionMode: string, exitCode = 0) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-plan-viewer-'));
  const previous = process.env.PIECEMAKER_HOME;
  process.env.PIECEMAKER_HOME = home;
  t.after(() => {
    if (previous === undefined) delete process.env.PIECEMAKER_HOME;
    else process.env.PIECEMAKER_HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  });
  const sent: NormalizedMessage[] = [];
  t.mock.method(childProcess, 'spawn', () => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true });
    setImmediate(() => {
      const records = [
        { ...finalResponse, id: 'old-plan', turnId: null },
        { ...finalResponse, id: 'progress', content: 'Je consulte le document.' },
        { sessionId, id: 'read-example', type: 'effect', detail: { toolName: 'file_system.read_file', input: { path: 'exemple.txt' } }, state: { status: 'completed', outputText: 'Texte fictif.' } },
        { ...finalResponse, content: '# Plan\n\n1.' },
        finalResponse,
      ];
      child.stdout.emit('data', Buffer.from(records.map(record => JSON.stringify(record)).join('\n') + '\n'));
      if (permissionMode === 'plan' || prompt.startsWith('/plan')) {
        assert.equal(sent.some(message => message.kind === 'stream_delta' || message.toolName === 'ExitPlanMode'), false);
      }
      child.emit('close', exitCode);
    });
    return child;
  });
  const provider = new MistralSessionsProvider();
  const context = {
    resolveProviderSessionId: () => sessionId,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
    normalizeMessage: provider.normalizeMessage.bind(provider),
    isProviderInstalled: async () => true,
  } as unknown as ProviderRuntimeContext;
  const writer = { send: (message: NormalizedMessage) => sent.push(message), userId: null } as unknown as ProviderRuntimeWriter;
  const run = mistralRuntime.run(prompt, { sessionId: 'app-example', cwd: home, permissionMode }, writer, context);
  if (exitCode) await assert.rejects(run);
  else await run;
  return sent;
}

for (const [prompt, permission] of [['/plan prépare les corrections', 'bypassPermissions'], ['Prépare les corrections', 'plan']]) {
  test(`le plan terminé utilise la carte de visionneuse : ${permission}`, async (t) => {
    const sent = await runPlan(t, prompt, permission);
    const plans = sent.filter(message => message.toolName === 'ExitPlanMode');
    assert.equal(plans.length, 1);
    assert.equal(plans[0].kind, 'tool_use');
    assert.equal(plans[0].toolId, finalResponse.id);
    assert.deepEqual(plans[0].toolInput, { plan: finalResponse.content[0].text });
    assert.ok(sent.find(message => message.toolName === 'file_system.read_file'));
    assert.ok(sent.indexOf(plans[0]) < sent.findIndex(message => message.kind === 'complete'));
    assert.equal(isVibePlanMessage(sessionId, 'progress'), false);
    assert.equal(isVibePlanMessage(sessionId, 'old-plan'), false);
    const [reloaded] = new MistralSessionsProvider().normalizeMessage(finalResponse, sessionId);
    assert.equal(reloaded.toolName, 'ExitPlanMode');
    assert.deepEqual(reloaded.toolInput, plans[0].toolInput);
  });
}

test('une réponse normale reste du texte sans carte de plan', async (t) => {
  const sent = await runPlan(t, 'Applique les corrections', 'bypassPermissions');
  assert.ok(sent.some(message => message.kind === 'stream_delta'));
  assert.equal(sent.some(message => message.toolName === 'ExitPlanMode'), false);
  assert.equal(isVibePlanMessage(sessionId, finalResponse.id), false);
});

test('un échec ne publie pas de plan terminé', async (t) => {
  const sent = await runPlan(t, '/plan prépare les corrections', 'plan', 1);
  assert.equal(sent.some(message => message.toolName === 'ExitPlanMode'), false);
  assert.equal(isVibePlanMessage(sessionId, finalResponse.id), false);
});
