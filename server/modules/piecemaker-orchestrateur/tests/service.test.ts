import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { wakeDisplay } from '../prompt.js';
import { createOrchestratorService } from '../service.js';
import type { OrchestratorDependencies, PermissionRequest, TurnOptions, TurnResult } from '../types.js';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const success = { started: true, error: null };
function fixture(ctx: TestContext) {
  ctx.mock.timers.enable({ apis: ['setInterval'] });
  const root = mkdtempSync(path.join(os.tmpdir(), 'pm-orchestrateur-'));
  let time = new Date(2026, 0, 5, 12, 0).getTime();
  const requests = new Map<string, PermissionRequest[]>();
  const aborted = new Set<string>();
  const processing = new Set<string>();
  const notices: string[] = [];
  const sessions: string[] = [];
  const turns: { session: string; content: string; options: TurnOptions; end: (result?: TurnResult) => void }[] = [];
  const deps: OrchestratorDependencies = {
    now: () => new Date(time), providers: async () => [
      { provider: 'codex', authenticated: true, installed: true }, { provider: 'claude', authenticated: true, installed: true },
    ],
    openSession: (_p, _root, title) => { sessions.push(title); return 'session-' + sessions.length; },
    runTurn: (session, _user, content, options) => new Promise(resolve => {
      processing.add(session);
      aborted.delete(session);
      turns.push({ session, content, options, end(result = success) { processing.delete(session); resolve(result); } });
    }),
    defaultModel: async (_p, purpose) => purpose === 'lookup' ? 'économique' : 'standard',
    permissions: async () => ({ allowedTools: ['Read'], disallowedTools: ['WebFetch'] }),
    lastAnswer: async session => 'Réponse de ' + session, history: async () => [], pending: session => requests.get(session) ?? [],
    resolve: (requestId) => {
      for (const [session, list] of requests) requests.set(session, list.filter(r => r.requestId !== requestId));
    },
    wasAborted: session => aborted.has(session), isProcessing: session => processing.has(session),
    abort: async (_p, session) => { aborted.add(session); turns.slice().reverse().find(t => t.session === session)?.end(); return true; },
    notify: (_u, _s, _title, text) => { notices.push(text); }, artifacts: () => [], connectors: () => [], approvedFolders: () => [root],
  };
  const service = createOrchestratorService(deps);
  service.start();
  ctx.after(() => { service.stop(); rmSync(root, { recursive: true, force: true }); });
  const state = () => service.state(root);
  const user = (text: string) => service.postUserMessage(root, text, 1);
  const call = async (tool: string, args: Record<string, unknown> = {}) =>
    service.call(root, (await state()).orchestrator.key, tool, args);
  const start = async (title: string, extra: Record<string, unknown> = {}) => {
    await call('start_thread', { title, instructions: title, ack_project: title, ack_thread: title, ...extra });
    await flush();
    return (await state()).threads.find(t => t.title === title)!;
  };
  const tick = async (ms: number) => {
    time += ms;
    ctx.mock.timers.tick(3000);
    await flush();
  };
  return { root, service, deps, turns, user, call, state, start, tick, requests, processing, notices, sessions };
}

test('Un tour regroupe les événements en attente, retire les yeux et publie la dernière réponse', async ctx => {
  const f = fixture(ctx);
  const unknown = path.join(f.root, 'inconnu');
  await assert.rejects(f.service.call(unknown, 'inconnue', 'list_threads'), { code: 403 });
  assert.equal(existsSync(unknown), false);
  const first = f.user('Premier');
  await flush();
  assert.deepEqual((await f.state()).messages[0].reactions, [{ by: 'system', emoji: '👀' }]);
  const key = (await f.state()).orchestrator.key;
  await assert.rejects(f.service.call(f.root, 'inconnue', 'post_message', { text: 'Refusé' }), { code: 403 });
  await assert.rejects(f.call('reply', { text: 'Refusé' }), { code: 403 });
  f.user('Deuxième');
  f.service.react(f.root, first.id, '👍', true);
  assert.equal(f.turns.length, 1);
  f.turns[0].end();
  await flush();
  assert.equal(f.turns.length, 2);
  assert.match(f.turns[1].content, /type="message".*Deuxième[^\n]*\n.*type="reaction"/);
  assert.doesNotMatch(f.turns[1].content, /# Your role/);
  assert.equal(f.turns[0].session, f.turns[1].session);
  await f.call('react', { message_id: first.id, emoji: '👌' });
  f.turns[1].end();
  await flush();
  const s = await f.state();
  assert.equal(s.messages.filter(m => m.author === 'orchestrator').length, 1);
  assert.equal(s.messages.find(m => m.author === 'orchestrator')?.text, 'Réponse de session-1');
  assert.ok(s.messages.every(m => m.reactions.every(r => r.by !== 'system')));
  await assert.rejects(f.service.call(f.root, key, 'read_memory'), { code: 403 });
});

test('Les places sont propres au fournisseur. Un échec relance une fois et un arrêt libère la place.', async ctx => {
  const f = fixture(ctx);
  f.service.updateSettings(f.root, { concurrency: { claude: 1 } });
  f.user('Commence');
  await flush();
  const a = await f.start('Premier');
  await f.tick(3000);
  const b = await f.start('Second');
  const c = await f.start('Autre', { provider: 'codex' });
  assert.equal(b.state, 'queued');
  assert.equal(c.state, 'working');
  await assert.rejects(f.service.call(f.root, a.key, 'start_thread'), { code: 403 });
  await assert.rejects(f.call('start_thread', { title: 'Absent', instructions: 'Lire', ack_project: 'Lire', ack_thread: 'Lire', provider: 'mistral' }), /suggest_connectors/);
  await f.service.stopThread(f.root, c.id);
  await flush();
  await f.tick(3000);
  f.turns.find(t => t.session === a.sessionId)!.end({ started: true, error: 'Erreur fictive' });
  await flush();
  const nextTurn = f.turns.at(-1)!;
  assert.equal(nextTurn.session, (await f.state()).threads.find(t => t.id === b.id)?.sessionId);
  nextTurn.end();
  await flush();
  const retry = f.turns.at(-1)!;
  assert.equal(retry.session, a.sessionId);
  assert.match(retry.content, /Erreur fictive/);
  retry.end({ started: true, error: 'Nouvel échec' });
  await flush();
  await f.tick(3000);
  const s = await f.state();
  assert.equal(s.threads.find(t => t.id === a.id)?.state, 'failed');
  assert.equal(s.threads.find(t => t.id === a.id)?.retries, 1);
  assert.equal(s.threads.find(t => t.id === c.id)?.state, 'stopped');
  assert.equal(f.turns.filter(t => t.session === c.sessionId).length, 1);
  assert.ok(f.sessions.includes(b.title));
});

test('Une autorisation bloque le fil. Le choix libère la carte et la boîte part en un tour.', async ctx => {
  const f = fixture(ctx);
  f.user('Commence');
  await flush();
  const a = await f.start('Analyser');
  const active = f.turns.at(-1)!;
  assert.ok(active.options.allowedTools.includes('Read'));
  assert.ok(active.options.disallowedTools.includes('mcp__orchestrateur'));
  assert.equal(active.options.permissionMode, 'bypassPermissions');
  assert.ok(active.options.disallowedTools.includes('AskUserQuestion'));
  f.requests.set(a.sessionId!, [{ requestId: 'accord', toolName: 'Lire', input: {} }]);
  await f.tick(3000);
  await f.tick(3000);
  let s = await f.state();
  assert.equal(s.threads[0].state, 'blocked');
  assert.deepEqual(f.notices, ['Lire']);
  const card = s.messages.find(m => m.approval)!;
  f.service.approval(f.root, card.id, true);
  assert.throws(() => f.service.approval(f.root, card.id, false), { code: 400 });
  await f.call('message_thread', { thread_id: a.id, text: 'Suite A' });
  await f.call('message_thread', { thread_id: a.id, text: 'Suite B' });
  s = await f.state();
  assert.equal(s.threads[0].state, 'working');
  assert.ok(s.orchestrator.pending.some(e => e.type === 'approval' && e.messageId === card.id && e.trust === 'principal'));
  await f.service.call(f.root, a.key, 'reply', { text: 'Note terminée', attached_outputs: [
    { kind: 'file', ref: 'note.docx' }, { kind: 'artifact', ref: '/artifacts/exemple' }, { kind: 'link', ref: 'https://example.org' },
  ] });
  active.end();
  await flush();
  s = await f.state();
  assert.equal(s.threads[0].replies[0].text, 'Note terminée');
  assert.deepEqual(s.deliverables.map(d => [d.kind, d.state]), [['document', 'a_relire'], ['artifact', 'a_relire']]);
  assert.equal(f.turns.length, 3);
  assert.match(f.turns[2].content, /Suite A[\s\S]*Suite B/);
  await assert.rejects(f.call('update_deliverable', { deliverable_id: s.deliverables[0].id, state: 'valide' }), { code: 400 });
  f.service.updateDeliverable(f.root, s.deliverables[0].id, 'valide');
  assert.equal((await f.state()).deliverables[0].state, 'valide');
  f.turns[2].end();
  await flush();
  f.processing.add(a.sessionId!);
  await f.tick(3000);
  assert.equal((await f.state()).threads[0].external, true);
  f.processing.delete(a.sessionId!);
  await f.tick(3000);
  assert.equal((await f.state()).threads[0].replies.length, 3);
});

test('Les minuteries respectent les échéances et le retour après absence précède le message', async ctx => {
  const f = fixture(ctx);
  f.user('Démarre');
  await flush();
  const t = await f.start('Lire');
  f.user('Où en sommes-nous ?');
  await f.call('no_reply_needed', { reason: 'holding_updates' });
  const deadline = new Date(f.deps.now().getTime() + 60000).toISOString();
  await f.call('send_later', { at: deadline, text: 'Rappel fictif' });
  await f.call('set_thread_reminder', { thread_id: t.id, days: 1 });
  const events = async () => (await f.state()).orchestrator.pending.map(e => e.type);
  await f.tick(59000);
  assert.deepEqual(await events(), ['message']);
  await f.tick(1000);
  assert.deepEqual(await events(), ['message', 'quiet', 'send_later']);
  await f.tick(540000);
  assert.equal((await events()).at(-1), 'time_limit');
  await f.tick(85800000);
  assert.equal((await events()).at(-1), 'reminder');
  f.user('Je reviens');
  assert.deepEqual((await events()).slice(-2), ['catch_up', 'message']);
  await f.call('no_reply_needed', { reason: 'holding_updates' });
  await f.call('post_message', { text: 'Voici le résultat.' });
  assert.equal((await f.state()).orchestrator.holdingUntil, null);
});

test('Le cron valide cinq champs et lance une seule routine par minute correspondante', async ctx => {
  const f = fixture(ctx);
  f.user('Planifie');
  await flush();
  const routine = (cron: string) => f.call('create_routine', { cron, title: 'Routine', instructions: 'Lire' });
  for (const cron of ['0 0', '60 * * * *', '* * * * 9', '*/0 * * * *', '* 18-8 * * *', '1,,2 * * * *']) {
    await assert.rejects(routine(cron), { code: 400 });
  }
  await routine('*/15 10-13 * 1,3 1-5');
  await f.tick(60000);
  assert.equal((await f.state()).threads.length, 0);
  await f.tick(14 * 60000);
  await f.tick(3000);
  assert.equal((await f.state()).threads.length, 1);
  assert.equal((await f.state()).orchestrator.pending.filter(e => e.type === 'routine').length, 1);
});

test('La mémoire refuse une ancienne révision. Le recyclage invalide la clé et reprend avec la mémoire.', async ctx => {
  const f = fixture(ctx);
  f.service.updateSettings(f.root, { recycleAfter: 1 });
  f.user('Premier');
  await flush();
  const first = (await f.state()).orchestrator;
  await f.call('update_memory', { revision: 0, text: 'Consigne fictive' });
  await assert.rejects(f.call('update_memory', { revision: 0, text: 'Écrasement' }), { code: 400 });
  f.turns[0].end();
  await flush();
  assert.equal((await f.state()).orchestrator.sessionId, null);
  f.user('Suite');
  await flush();
  await assert.rejects(f.service.call(f.root, first.key, 'post_message', { text: 'Ancienne clé' }), { code: 403 });
  assert.notEqual(f.turns[1].session, first.sessionId);
  assert.match(f.turns[1].content, /Do not repost anything[\s\S]*Consigne fictive/);
  f.service.updateSettings(f.root, { recycleAfter: 60 });
  f.turns[1].end({ started: true, error: 'Erreur' });
  await flush();
  assert.equal((await f.state()).orchestrator.sessionId, null);
});

test('Un dossier extérieur attend un accord propre au fil, y compris après une mise en file', async ctx => {
  const f = fixture(ctx);
  f.user('Démarre');
  await flush();
  const folder = path.join(os.tmpdir(), 'dossier-fictif-externe');
  const a = await f.start('Autorisé', { folder });
  const b = await f.start('Refusé', { folder });
  await assert.rejects(f.call('update_project_settings', { folders: [folder] }), { code: 403 });
  await f.tick(3000);
  assert.equal(f.turns.length, 1);
  const cards = (await f.state()).messages.filter(m => m.folderRequest);
  f.service.folder(f.root, cards[0].id, true);
  await flush();
  assert.equal((await f.state()).threads.find(t => t.id === a.id)?.state, 'working');
  assert.equal((await f.state()).threads.find(t => t.id === b.id)?.state, 'queued');
  f.service.folder(f.root, cards[1].id, false);
  assert.equal((await f.state()).threads.find(t => t.id === b.id)?.state, 'stopped');
  assert.equal(f.turns.length, 2);
});

test('Le redémarrage conserve les événements et reprend une fois le fil interrompu', async ctx => {
  const f = fixture(ctx);
  f.user('Démarre');
  await flush();
  await f.start('Interrompu');
  f.user('Message en attente');
  f.service.stop();
  const restarted = createOrchestratorService(f.deps);
  restarted.start();
  ctx.after(() => restarted.stop());
  const snapshot = await restarted.state(f.root);
  assert.equal(snapshot.orchestrator.running, false);
  assert.equal(snapshot.orchestrator.pending[0].text, 'Message en attente');
  assert.equal(snapshot.threads[0].state, 'failed');
  assert.equal(snapshot.threads[0].error, 'Interrompu : serveur redémarré');
  const saved = JSON.parse(readFileSync(path.join(f.root, '.piecemaker/orchestrateur/etat.json'), 'utf8'));
  assert.equal(saved.revision, snapshot.revision);
  f.processing.clear();
  await f.tick(3000);
  assert.equal((await restarted.state(f.root)).threads[0].retries, 1);
  assert.match(f.turns.slice().reverse().find(t => t.session === snapshot.threads[0].sessionId)!.content, /serveur redémarré/);
});

test('Le fil reçoit le choix de l’avocat et la recherche rapide revient sans créer de fil', async ctx => {
  const f = fixture(ctx);
  f.user('Prépare une note');
  await flush();
  const t = await f.start('Préparer');
  await f.service.call(f.root, t.key, 'ask_decision', { question: 'Quel format ?', options: [
    { label: 'Court', consequence: 'Une page' }, { label: 'Long', consequence: 'Trois pages' },
  ], recommended: 0 });
  const d = (await f.state()).decisions[0];
  await f.call('post_thread_card', { decision_id: d.id });
  f.service.chooseDecision(f.root, d.id, 1);
  f.turns[1].end();
  await flush();
  assert.match(f.turns[2].content, /<decision>Long<\/decision>/);
  await f.call('lookup', { question: 'Quelle date ?' });
  const search = f.turns.at(-1)!;
  assert.equal(search.options.permissionMode, 'plan');
  assert.equal(search.options.model, 'économique');
  search.end();
  await flush();
  const s = await f.state();
  assert.equal(s.threads.length, 1);
  assert.equal(s.decisions[0].chosen, 1);
  assert.ok(s.orchestrator.pending.some(e => e.type === 'lookup_result' && e.trust === 'relay' && e.text === 'Réponse de ' + search.session));
});

test('La mise en route attend le choix de l’avocat et conserve le clic du widget', async ctx => {
  const f = fixture(ctx);
  f.user('Organise le dossier');
  await flush();
  await f.call('post_widget', { type: 'draft', draft: { body: 'Brouillon' } });
  await f.call('propose_project_setup', { instructions: 'Rédiger en français.', threads: [
    { title: 'Premier fil', instructions: 'Lire' }, { title: 'Second fil', instructions: 'Classer' },
  ] });
  const before = await f.state();
  assert.equal(before.threads.length, 0);
  const widgetId = before.messages.find(m => m.widget)!.id;
  const setupId = before.messages.find(m => m.setup)!.id;
  f.service.widgetAction(f.root, widgetId, 'envoyer', 'Texte relu');
  await f.service.setup(f.root, setupId, true);
  await flush();
  const s = await f.state();
  assert.equal(s.messages.find(m => m.id === widgetId)?.widget?.state?.clicked, 'envoyer');
  assert.ok(s.orchestrator.pending.some(e => e.type === 'widget_action' && e.text === 'Texte relu' && e.attrs?.action_id === 'envoyer'));
  assert.equal(s.settings.instructions, 'Rédiger en français.');
  assert.equal(s.threads.length, 2);
  assert.match(f.turns[1].content, /Rédiger en français/);
  await assert.rejects(f.service.setup(f.root, setupId, true), { code: 400 });
});

test('Sans fournisseur connecté, l’orchestrateur prévient une fois, réessaie après 10 s et garde les événements', async ctx => {
  const f = fixture(ctx);
  let connected = false;
  f.deps.providers = async () => [{ provider: 'claude', authenticated: connected, installed: true }];
  f.user('Bonjour');
  await f.tick(0);
  await f.tick(3000);
  let state = await f.state();
  assert.equal(f.turns.length, 0);
  assert.equal(state.messages.filter(m => m.connect).length, 1);
  assert.equal(state.orchestrator.pending.length, 1);
  assert.equal(state.orchestrator.recaps, 0);
  connected = true;
  await f.tick(11000);
  await flush();
  state = await f.state();
  assert.equal(f.turns.length, 1);
  assert.equal(state.orchestrator.pending.length, 0);
});

test('La session de l’agent est une session CloudCLI : le message écrit dans son chat part en wake avec les règles', async ctx => {
  const f = fixture(ctx);
  const opened = await f.service.session(f.root, 1);
  assert.deepEqual(opened, { sessionId: 'session-1', provider: 'claude' });
  assert.deepEqual(await f.service.session(f.root), opened);
  assert.equal(f.service.isOrchestratorSession('session-1'), true);
  assert.equal(f.service.isOrchestratorSession('autre'), false);
  assert.equal(await f.service.composerTurn(f.root, 'autre', 'Bonjour', null, async () => success), false);
  const runs: { content: string; options: TurnOptions }[] = [];
  let finish!: (result: TurnResult) => void;
  const turn = f.service.composerTurn(f.root, 'session-1', 'Prépare les conclusions', null, (content, options) => {
    runs.push({ content, options });
    return new Promise(resolve => { finish = resolve; });
  });
  await flush();
  assert.equal(runs.length, 1);
  assert.match(runs[0].content, /# Your role[\s\S]*<wake reason="message"[^>]*>\n {2}<event type="message" trust="principal"[^>]*>Prépare les conclusions<\/event>/);
  assert.ok(runs[0].options.allowedTools.includes('mcp__orchestrateur'));
  assert.equal(wakeDisplay(runs[0].content), 'Prépare les conclusions');
  const key = (await f.state()).orchestrator.key;
  await f.service.call(f.root, key, 'no_reply_needed', { reason: 'nothing_to_add' });
  finish(success);
  assert.equal(await turn, true);
  const s = await f.state();
  assert.equal(s.orchestrator.running, false);
  assert.equal(s.orchestrator.turns, 1);
  assert.equal(s.messages[0].author, 'user');
  assert.equal(f.turns.length, 0);
  await f.service.composerTurn(f.root, 'session-1', 'Et ensuite ?', null, async (content) => {
    assert.doesNotMatch(content, /# Your role/);
    return success;
  });
});

test('Un wake sans message de l’avocat s’affiche comme une ligne lisible', () => {
  assert.equal(wakeDisplay('Bonjour'), null);
  assert.equal(wakeDisplay('<wake reason="thread_reply" time="t" presence="p" session_key="k">\n  <event type="thread_reply" trust="relay" at="t" thread="thr_1" title="Rédiger l&quot;acte" state="review_ready">Fait.</event>\n</wake>'),
    'Réponse du fil « Rédiger l"acte »');
});

test('Lire la session de l’agent d’un dossier sans agent ne crée rien', ctx => {
  const f = fixture(ctx);
  const other = mkdtempSync(path.join(os.tmpdir(), 'pm-orchestrateur-vide-'));
  ctx.after(() => rmSync(other, { recursive: true, force: true }));
  assert.equal(f.service.sessionId(other), null);
  assert.equal(existsSync(path.join(other, '.piecemaker')), false);
});

test('Le démarrage survit à une base pas encore prête et reprend les dossiers au tick suivant', ctx => {
  ctx.mock.timers.enable({ apis: ['setInterval'] });
  ctx.mock.method(console, 'warn', () => {});
  let ready = false;
  let calls = 0;
  const service = createOrchestratorService({
    approvedFolders: () => { calls += 1; if (!ready) throw new Error('no such table: projects'); return []; },
  } as unknown as OrchestratorDependencies);
  assert.doesNotThrow(() => service.start());
  ready = true;
  ctx.mock.timers.tick(3000);
  ctx.mock.timers.tick(3000);
  assert.equal(calls, 2);
  service.stop();
});
