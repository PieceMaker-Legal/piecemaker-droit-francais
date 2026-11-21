import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { createOrchestratorService } from '../service.js';
import type { OrchestratorDependencies, TurnOptions, TurnResult } from '../types.js';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture(ctx: TestContext) {
  ctx.mock.timers.enable({ apis: ['setInterval'] });
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pm-central-')));
  const central = path.join(base, 'PieceMaker Agent');
  const dupont = path.join(base, 'Dossier Dupont');
  const exemple = path.join(base, 'Societe Exemple');
  const autre = path.join(base, 'Dossier Martin');
  for (const folder of [dupont, exemple, autre]) mkdirSync(folder);
  const opened: Array<{ title: string; root: string; hidden?: boolean }> = [];
  const turns: { session: string; content: string; options: TurnOptions; end: (result?: TurnResult) => void }[] = [];
  const deps: OrchestratorDependencies = {
    centralRoot: central,
    now: () => new Date(2026, 0, 5, 12, 0),
    providers: async () => [{ provider: 'claude', authenticated: true, installed: true }],
    openSession: (_p, root, title, hidden) => { opened.push({ title, root, hidden }); return 'session-' + opened.length; },
    runTurn: (session, _user, content, options) => new Promise(resolve => {
      turns.push({ session, content, options, end(result = { started: true, error: null }) { resolve(result); } });
    }),
    previousPostIds: async () => new Set(), chatChanged() {}, changeChatProvider() {}, contextRatio: async () => null,
    sessionModel: () => null, defaultModel: async () => 'standard', models: async () => [],
    permissions: async () => ({ allowedTools: [], disallowedTools: [] }),
    lastAnswer: async () => 'Réponse', history: async () => [], pending: () => [], resolve() {},
    wasAborted: () => false, isProcessing: () => false, abort: async () => true, notify() {},
    approvedFolders: () => [dupont, exemple, autre], artifacts: () => [], connectors: () => [],
  };
  const service = createOrchestratorService(deps);
  service.start();
  ctx.after(() => { service.stop(); rmSync(base, { recursive: true, force: true }); });
  const state = () => service.state(central);
  const call = async (tool: string, args: Record<string, unknown> = {}) => service.call(central, (await state()).orchestrator.key, tool, args);
  return { central, dupont, exemple, autre, service, opened, turns, state, call };
}

test('L’agent central ouvre sa conversation dans son propre dossier et choisit ses dossiers parmi les dossiers connus', async ctx => {
  const f = fixture(ctx);
  assert.equal(f.service.isCentral(f.central), true);
  assert.equal(f.service.isCentral(f.dupont), false);
  const session = await f.service.centralSession(1);
  assert.equal(session.project, f.central);
  assert.deepEqual(f.opened[0], { title: 'PieceMaker Agent', root: f.central, hidden: undefined });
  assert.equal(f.service.central().sessionId, session.sessionId);
  f.service.updateSettings(f.central, { folders: [f.dupont, 'Societe Exemple'] });
  const s = await f.state();
  assert.equal(s.central, true);
  assert.deepEqual(s.settings.folders, [f.dupont, f.exemple]);
  assert.deepEqual(s.dossiers, [
    { path: f.dupont, selected: true }, { path: f.exemple, selected: true }, { path: f.autre, selected: false },
  ]);
  assert.throws(() => f.service.updateSettings(f.central, { folders: [path.join(f.central, '..', 'Inconnu')] }), /inconnu/);
});

test('Chaque fil travaille dans un seul dossier choisi, rangé dans ce dossier et tenu à l’écart des autres', async ctx => {
  const f = fixture(ctx);
  f.service.updateSettings(f.central, { folders: [f.dupont, f.exemple] });
  f.service.postUserMessage(f.central, 'Prépare les conclusions Dupont', 1);
  await flush();
  const thread = { title: 'Rédiger les conclusions', instructions: 'Rédiger', ack_project: 'Je lance', ack_thread: 'Je rédige' };
  await assert.rejects(f.call('start_thread', thread), /Dossier requis/);
  await assert.rejects(f.call('start_thread', { ...thread, folder: f.central }), /inconnu/);
  const devices = await f.call('list_devices') as Array<{ folder: string; allowed: boolean }>;
  assert.deepEqual(devices.map(d => [d.folder, d.allowed]), [[f.dupont, true], [f.exemple, true], [f.autre, false]]);
  await f.call('start_thread', { ...thread, folder: f.dupont });
  await flush();
  const run = f.turns.at(-1)!;
  const opened = f.opened.at(-1)!;
  assert.deepEqual([opened.title, opened.root], ['Rédiger les conclusions', f.dupont]);
  assert.match(run.content, new RegExp(`You work only in this case folder: ${f.dupont}`));
  assert.ok(run.options.disallowedTools.includes(`Read(/${f.exemple}/**)`));
  assert.ok(run.options.disallowedTools.includes(`Edit(/${f.autre}/**)`));
  assert.ok(!run.options.disallowedTools.some(rule => rule.includes(f.dupont)));
  await f.call('update_deliverable', { thread_id: (await f.state()).threads[0].id, ref: 'conclusions.docx' });
  await assert.rejects(f.call('update_deliverable', { thread_id: (await f.state()).threads[0].id, ref: '../Societe Exemple/note.docx' }), /relatif/);
});

test('Un dossier non choisi exige l’accord de l’avocat avant que le fil parte', async ctx => {
  const f = fixture(ctx);
  f.service.postUserMessage(f.central, 'Regarde le dossier Martin', 1);
  await flush();
  await f.call('start_thread', { title: 'Lire le dossier', instructions: 'Lire', ack_project: 'Je lance', ack_thread: 'Je lis', folder: 'Dossier Martin' });
  await flush();
  let s = await f.state();
  const request = s.messages.find(m => m.folderRequest)!;
  assert.equal(s.threads[0].state, 'queued');
  assert.equal(request.folderRequest?.folder, f.autre);
  assert.equal(f.opened.some(o => o.root === f.autre), false);
  f.service.folder(f.central, request.id, true);
  await flush();
  s = await f.state();
  assert.deepEqual(s.settings.folders, [f.autre]);
  assert.equal(s.threads[0].state, 'working');
  assert.equal(f.opened.at(-1)!.root, f.autre);
});
