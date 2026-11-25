import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { openProjectStore } from '../store.js';
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
  const reports: Array<{ session: string; root: string; since: string }> = [];
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
    herissonReport: async (session, root, since) => { reports.push({ session, root, since }); return 'Rapport hérisson (1 check(s) on the work of this thread):'; },
    wasAborted: () => false, isProcessing: () => false, abort: async () => true, notify() {},
    approvedFolders: () => [dupont, exemple, autre], artifacts: () => [], connectors: () => [],
  };
  const service = createOrchestratorService(deps);
  service.start();
  ctx.after(() => { service.stop(); rmSync(base, { recursive: true, force: true }); });
  const state = () => service.state(central);
  const call = async (tool: string, args: Record<string, unknown> = {}) => service.call(central, (await state()).orchestrator.key, tool, args);
  return { central, dupont, exemple, autre, service, opened, turns, reports, state, call };
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
  assert.ok(run.content.includes(`You work only in this case folder: ${f.dupont}`));
  assert.ok(!run.options.disallowedTools.some(rule => rule.includes(f.dupont)));
  if (process.platform !== 'win32') {
    assert.ok(run.options.disallowedTools.includes(`Read(/${f.exemple}/**)`));
    assert.ok(run.options.disallowedTools.includes(`Edit(/${f.autre}/**)`));
  }
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

test('Le dream sans activité de dossier ne rêve rien et reste réservé à l’agent central', async ctx => {
  const f = fixture(ctx);
  await f.state();
  f.service.updateSettings(f.central, { dream: { enabled: true, cron: '0 12 * * *' } });
  assert.deepEqual((await f.state()).settings.dream, { enabled: true, provider: 'auto', model: '', cron: '0 12 * * *' });
  ctx.mock.timers.tick(3000);
  for (let i = 0; i < 5; i++) await flush();
  assert.equal(f.turns.length, 0);
  assert.equal(f.opened.length, 0);
  const s = await f.state();
  assert.ok(s.dream?.lastResult?.includes('rien à rêver'));
  assert.ok(s.messages.some(m => m.text.startsWith('Dream du ') && m.text.includes('rien à rêver')));
  assert.throws(() => f.service.updateSettings(f.dupont, { dream: { enabled: true } }), /réservé/);
});

test('Le dream rêve chaque dossier actif par un tour analyze puis un tour organize sur son bundle OKF', async ctx => {
  const f = fixture(ctx);
  await f.state();
  f.service.updateSettings(f.central, { folders: [f.dupont] });
  f.service.postUserMessage(f.central, 'Mets à jour le suivi Dupont', 1);
  await flush();
  await f.call('start_thread', { title: 'Suivi Dupont', instructions: 'Suivi', ack_project: 'Je lance', ack_thread: 'Je m’en occupe', folder: f.dupont });
  await flush();
  f.turns.at(-1)!.end();
  for (let i = 0; i < 5; i++) await flush();
  f.turns[0].end();
  for (let i = 0; i < 5; i++) await flush();
  f.service.updateSettings(f.central, { dream: { enabled: true, cron: '0 12 * * *' } });
  ctx.mock.timers.tick(3000);
  for (let i = 0; i < 5; i++) await flush();
  const dream = f.opened.find(o => o.title === 'Dream')!;
  assert.deepEqual(dream, { title: 'Dream', root: f.dupont, hidden: true });
  const sessionId = 'session-' + (f.opened.indexOf(dream) + 1);
  const analyze = f.turns.at(-1)!;
  assert.equal(analyze.session, sessionId);
  assert.ok(analyze.content.startsWith('# Dream — analyze'));
  assert.ok(analyze.content.includes(`Case folder: ${f.dupont}`));
  assert.ok(analyze.content.includes('Suivi Dupont'));
  assert.equal(analyze.options.permissionMode, 'acceptEdits');
  assert.ok(analyze.options.allowedTools.includes('Skill'));
  assert.ok(analyze.options.disallowedTools.includes('Bash'));
  analyze.end();
  for (let i = 0; i < 5; i++) await flush();
  const organize = f.turns.at(-1)!;
  assert.equal(organize.session, sessionId);
  assert.ok(organize.content.startsWith('# Dream — organize'));
  organize.end();
  for (let i = 0; i < 5; i++) await flush();
  const s = await f.state();
  assert.equal(s.dream?.lastError, null);
  assert.ok(s.dream?.lastResult?.includes('Réponse'));
  assert.ok(s.messages.some(m => m.text.startsWith('Dream du ') && m.text.includes('Réponse')));
  const count = f.turns.length;
  ctx.mock.timers.tick(3000);
  for (let i = 0; i < 5; i++) await flush();
  assert.equal(f.turns.length, count);
});

test('Un réglage dream à heure fixe devient un cron à l’ouverture du dossier', () => {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pm-dream-')));
  const dir = path.join(base, '.piecemaker', 'orchestrateur');
  mkdirSync(path.join(dir, 'fichiers'), { recursive: true });
  writeFileSync(path.join(dir, 'etat.json'), JSON.stringify({
    version: 1, revision: 1, threads: [], messages: [], decisions: [], schedules: [], deliverables: [], lookups: [],
    orchestrator: { chatSessionId: null, chatProvider: null, needsRecap: false, heldUpdates: [], sessionId: null, key: 'k', provider: null, turns: 0, running: false, pending: [], holdingUntil: null, quietAt: null, lastUserAt: null, postsSinceUser: 0, userId: null, recaps: 0 },
    settings: { instructions: '', defaultProvider: 'chat', orchestratorProvider: 'auto', orchestratorModel: '', defaultModels: {}, concurrency: { claude: 3, codex: 3, mistral: 3 }, folders: [], recycleAfter: 60, dream: { enabled: true, provider: 'auto', model: '', hour: 20 } },
  }));
  const store = openProjectStore(base);
  assert.deepEqual(store.state.settings.dream, { enabled: true, provider: 'auto', model: '', cron: '0 20 * * *' });
  rmSync(base, { recursive: true, force: true });
});

test('La réponse d’un fil revient à l’agent central avec le rapport du Hérisson sur son travail', async ctx => {
  const f = fixture(ctx);
  f.service.updateSettings(f.central, { folders: [f.dupont] });
  f.service.postUserMessage(f.central, 'Mets à jour le suivi Dupont', 1);
  await flush();
  await f.call('start_thread', { title: 'Mettre à jour le suivi', instructions: 'Suivi', ack_project: 'Je lance', ack_thread: 'Je m’en occupe', folder: f.dupont });
  await flush();
  f.turns.at(-1)!.end();
  await flush();
  await flush();
  assert.deepEqual(f.reports.map(r => [r.session, r.root]), [[f.turns.at(-1)!.session, f.dupont]]);
  const thread = (await f.state()).threads[0];
  assert.equal(thread.replies.at(-1)!.text, 'Réponse\n\n<system-report>\nRapport hérisson (1 check(s) on the work of this thread):\n</system-report>');
  f.turns[0].end();
  for (let i = 0; i < 5; i++) await flush();
  const wake = f.turns.find(turn => turn.content.includes('<system-report>'));
  assert.ok(wake, 'le réveil de l’agent central porte le rapport');
});
