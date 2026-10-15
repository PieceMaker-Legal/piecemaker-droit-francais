import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readPlanCommand } from '@/modules/providers/list/mistral/mistral-plan-command.js';
import { mistralRuntime } from '@/modules/providers/list/mistral/mistral-runtime.provider.js';
import type { ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/index.js';

test('/plan est retiré du message et demande l’agent plan', () => {
  assert.deepEqual(readPlanCommand('/plan trie les pièces'), { prompt: 'trie les pièces', plan: true });
  assert.deepEqual(readPlanCommand('crée un plan /plan pour trier les pièces'), { prompt: 'crée un plan pour trier les pièces', plan: true });
  assert.deepEqual(readPlanCommand('trie les pièces /plan'), { prompt: 'trie les pièces', plan: true });
  assert.deepEqual(readPlanCommand('/plan'), { prompt: '/plan', plan: true });
});

test('un chemin ou un mot contenant /plan ne déclenche rien', () => {
  for (const prompt of ['lis ~/.vibe/plans/a.md', 'ouvre docs/plan', 'un plan simple', '/planifier']) {
    assert.deepEqual(readPlanCommand(prompt), { prompt, plan: false });
  }
});

async function vibeArgs(t: test.TestContext, prompt: string, permissionMode?: string) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const previous = process.env.PIECEMAKER_HOME;
  process.env.PIECEMAKER_HOME = home;
  t.after(() => {
    if (previous === undefined) delete process.env.PIECEMAKER_HOME;
    else process.env.PIECEMAKER_HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  });
  let args: string[] = [];
  t.mock.method(childProcess, 'spawn', (_command: string, spawnArgs: string[]) => {
    args = spawnArgs;
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true });
    setImmediate(() => child.emit('close', 0));
    return child;
  });
  const context = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
    normalizeMessage: () => [],
    isProviderInstalled: async () => true,
  } as unknown as ProviderRuntimeContext;
  const writer = { send() {}, userId: null } as unknown as ProviderRuntimeWriter;
  await mistralRuntime.run(prompt, { sessionId: 'app-1', cwd: os.tmpdir(), permissionMode }, writer, context);
  return args;
}

const agentOf = (args: string[]) => args[args.indexOf('--agent') + 1];
const promptOf = (args: string[]) => args[args.indexOf('-p') + 1];

test('Vibe démarre avec l’agent plan quand le message contient /plan', async (t) => {
  const args = await vibeArgs(t, '/plan trie les pièces', 'bypassPermissions');
  assert.equal(agentOf(args), 'plan');
  assert.equal(args.includes('--auto-approve'), false);
  assert.equal(promptOf(args), 'trie les pièces');
});

test('sans /plan, Vibe garde le mode choisi', async (t) => {
  const args = await vibeArgs(t, 'trie les pièces', 'acceptEdits');
  assert.equal(agentOf(args), 'accept-edits');
  assert.equal(promptOf(args), 'trie les pièces');
});

test('Contourner les permissions Vibe passe --auto-approve', async (t) => {
  const args = await vibeArgs(t, 'trie les pièces', 'bypassPermissions');
  assert.equal(args.includes('--auto-approve'), true);
  assert.equal(args.includes('--agent'), false);
  assert.equal(promptOf(args), 'trie les pièces');
});
