import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    previousPostIds: async () => new Set(), chatChanged() {}, changeChatProvider() {}, contextRatio: async () => null,
    sessionModel: () => null,
    defaultModel: async (_p, purpose) => purpose === 'lookup' ? 'économique' : 'standard',
    models: async () => [],
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

test('Un tour regroupe les événements en attente, retire les yeux sans publier la réponse privée', async ctx => {
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
  assert.ok(s.messages.every(m => m.author === 'user'));
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
  assert.equal((await f.state()).schedules[0].nextRunAt, new Date(2026, 0, 5, 12, 15).toISOString());
  await f.tick(14 * 60000);
  await f.tick(3000);
  assert.equal((await f.state()).threads.length, 1);
  assert.equal((await f.state()).orchestrator.pending.filter(e => e.type === 'routine').length, 1);
});

test('Annuler un rappel, un message différé et une routine empêche leur exécution', async ctx => {
  const f = fixture(ctx);
  f.user('Planifie');
  await flush();
  const t = await f.start('Fil fictif');
  await f.call('set_thread_reminder', { thread_id: t.id, days: 1 });
  await f.call('send_later', { text: 'Message fictif', at: f.deps.now().toISOString() });
  await f.call('create_routine', { cron: '* * * * *', title: 'Routine fictive', instructions: 'Lire' });
  f.service.cancelScheduled(f.root, 'reminder', t.id);
  for (const item of (await f.state()).schedules) f.service.cancelScheduled(f.root, item.kind, item.id);
  await f.tick(86400000);
  const state = await f.state();
  assert.equal(state.threads[0].reminderAt, null);
  assert.equal(state.schedules.length, 2);
  assert.ok(state.schedules.every(item => item.stoppedAt && item.nextRunAt === null));
  assert.equal(state.threads.length, 1);
  assert.ok(!state.orchestrator.pending.some(event => ['reminder', 'send_later', 'routine'].includes(event.type)));
});

test('Une tâche ne se supprime qu’une fois arrêtée', async ctx => {
  const f = fixture(ctx);
  f.user('Planifie');
  await flush();
  await f.call('create_routine', { cron: '* * * * *', title: 'Routine fictive', instructions: 'Lire' });
  const [routine] = (await f.state()).schedules;
  assert.throws(() => f.service.deleteScheduled(f.root, 'cron', routine.id), { code: 409 });
  f.service.cancelScheduled(f.root, 'cron', routine.id);
  assert.deepEqual(await f.call('list_routines', {}), []);
  f.service.deleteScheduled(f.root, 'cron', routine.id);
  assert.equal((await f.state()).schedules.length, 0);
});

for (const trigger of ['tours', 'usage', 'échec', 'manuel', 'fournisseur']) {
  test('Le recyclage attend la fin du tour et conserve le chat : ' + trigger, async ctx => {
    const f = fixture(ctx);
    const chat = await f.service.session(f.root);
    f.service.updateSettings(f.root, { recycleAfter: trigger === 'tours' ? 1 : 60, instructions: 'Consigne du projet' });
    let reads = 0;
    f.deps.contextRatio = async () => { reads++; return trigger === 'usage' ? 0.71 : 0.7; };
    const original = 'Premier message ' + 'x'.repeat(500);
    f.user(original);
    await flush();
    const first = (await f.state()).orchestrator;
    await f.call('update_memory', { revision: 0, text: 'Mémoire fictive' });
    await assert.rejects(f.call('update_memory', { revision: 0, text: 'Écrasement' }), { code: 400 });
    await f.call('no_reply_needed', { reason: 'holding_updates' });
    if (trigger === 'manuel') f.service.recycle(f.root);
    if (trigger === 'fournisseur') f.service.updateSettings(f.root, { orchestratorProvider: 'codex' });
    f.user('En attente');
    assert.equal(f.turns.length, 1);
    assert.equal(reads, 0);
    f.turns[0].end(trigger === 'échec' ? { started: true, error: 'Erreur fictive' } : success);
    await flush();
    assert.notEqual(f.turns[1].session, first.sessionId);
    assert.match(f.turns[1].content, /Do not repost anything[\s\S]*Mémoire fictive/);
    assert.ok(f.turns[1].content.includes(original));
    assert.ok(f.turns[1].content.includes('Consigne du projet'));
    assert.doesNotMatch(f.turns[1].content, /<wake reason=/);
    f.user('Pendant la reprise');
    await flush();
    assert.equal(f.turns.length, 2);
    await assert.rejects(f.service.call(f.root, first.key, 'post_message', { text: 'Ancienne clé' }), { code: 403 });
    f.turns[1].end();
    await flush();
    assert.equal(f.turns[2].session, f.turns[1].session);
    assert.match(f.turns[2].content, /En attente[\s\S]*Pendant la reprise/);
    assert.doesNotMatch(f.turns[2].content, /# Your role/);
    assert.equal((await f.service.session(f.root)).sessionId, chat.sessionId);
  });
}

test('La reprise conserve les travaux, les attentes et les livrables du dossier', async ctx => {
  const f = fixture(ctx);
  f.user('Classer les pièces');
  await flush();
  const thread = await f.start('Vérifier le classement');
  await f.call('set_thread_reminder', { thread_id: thread.id, days: 2 });
  await f.call('update_deliverable', { thread_id: thread.id, ref: 'classement.docx', kind: 'document' });
  await f.call('send_later', { at: '2026-01-10T12:00:00Z', text: 'Vérifier la réponse' });
  await f.call('ask_decision', { question: 'Quel format ?', recommended: 0, options: [
    { label: 'Document', consequence: 'Modifiable' }, { label: 'PDF', consequence: 'Figé' },
  ] });
  await f.call('no_reply_needed', { reason: 'holding_updates' });
  f.service.recycle(f.root);
  f.turns[0].end();
  await flush();
  const recap = f.turns.at(-1)!.content;
  for (const value of [thread.title, 'working', 'classement.docx', 'Vérifier la réponse', 'Quel format ?', (await f.state()).threads[0].reminderAt!]) {
    assert.ok(recap.includes(value), value);
  }
  assert.match(recap, /"heldUpdates": \[\s*\{[\s\S]*Classer les pièces/);
  assert.ok(!recap.includes(thread.key));
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
  f.deps.providers = async userId => [{ provider: 'mistral', authenticated: connected && userId === 1, installed: true }];
  f.user('Bonjour');
  await f.tick(0);
  await f.tick(3000);
  let state = await f.state();
  assert.equal(f.turns.length, 0);
  assert.equal(state.messages.filter(m => m.connect).length, 1);
  assert.equal(state.orchestrator.pending.length, 1);
  assert.equal(state.orchestrator.recaps, 0);
  connected = true;
  assert.equal((await f.service.state(f.root, 2)).providers[0].authenticated, false);
  assert.equal((await f.service.state(f.root, 1)).providers[0].authenticated, true);
  await f.tick(11000);
  await flush();
  state = await f.state();
  assert.equal(f.turns.length, 1);
  assert.equal(state.orchestrator.pending.length, 0);
});

test('Le chat conserve les posts et les sorties, et fournit le modèle du tour privé', async ctx => {
  const f = fixture(ctx);
  const chat = await f.service.session(f.root, 1);
  f.deps.sessionModel = id => id === chat.sessionId ? 'modele-fictif' : null;
  f.user('Prépare le document');
  await flush();
  assert.notEqual(f.turns[0].session, chat.sessionId);
  assert.equal(f.turns[0].options.model, 'modele-fictif');
  await f.call('post_message', { text: 'Document prêt', attached_outputs: [{ kind: 'file', ref: 'exemple.docx' }] });
  await f.call('no_reply_needed', { reason: 'nothing_to_add' });
  f.turns[0].end();
  await flush();
  const history = await f.service.chatHistory(f.root, chat.sessionId!);
  assert.deepEqual(history?.map(m => [m.role, m.content]), [
    ['user', 'Prépare le document'], ['assistant', 'Document prêt'],
  ]);
  assert.deepEqual(history?.[1].agentCard?.outputs, [{ kind: 'file', ref: 'exemple.docx' }]);
  assert.equal(await f.service.chatHistory(f.root, f.turns[0].session), null);
});

test('Un ancien dossier conserve son chat et attend le prochain événement pour reprendre', async ctx => {
  const f = fixture(ctx);
  await f.service.session(f.root);
  f.service.stop();
  const file = path.join(f.root, '.piecemaker/orchestrateur/etat.json');
  const old = JSON.parse(readFileSync(file, 'utf8'));
  delete old.orchestrator.chatSessionId;
  const message = { author: 'orchestrator', at: '2026-01-01', attachments: [], decisionIds: [], reactions: [] };
  old.messages.push({ ...message, id: 'post', text: 'Réponse publiée' }, { ...message, id: 'fin', text: 'Récapitulatif privé' });
  f.deps.previousPostIds = async id => new Set(id === 'ancien-chat' ? ['post'] : []);
  Object.assign(old.orchestrator, { sessionId: 'ancien-chat', provider: 'claude', turns: 12 });
  writeFileSync(file, JSON.stringify(old));
  const restarted = createOrchestratorService(f.deps);
  restarted.start();
  ctx.after(() => restarted.stop());
  assert.equal(restarted.sessionId(f.root), 'ancien-chat');
  assert.deepEqual((await restarted.chatHistory(f.root, 'ancien-chat'))?.map(row => row.content), ['Réponse publiée']);
  await f.tick(3000);
  assert.equal(f.turns.length, 0);
  restarted.postUserMessage(f.root, 'Suite');
  await flush();
  assert.notEqual(f.turns[0].session, 'ancien-chat');
  assert.match(f.turns[0].content, /separate wake/);
  f.turns[0].end();
  await flush();
  assert.equal(wakeDisplay(f.turns[1].content), 'Suite');
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

test('Un modèle inconnu du fournisseur est refusé, list_providers donne les modèles et une erreur de modèle ne relance pas', async ctx => {
  const f = fixture(ctx);
  f.deps.models = async p => p === 'codex' ? [{ value: 'modele-codex', label: 'Modèle Codex' }] : [{ value: 'modele-claude', label: 'Modèle Claude' }];
  f.user('Lance');
  await flush();
  await assert.rejects(f.start('Mauvais couple', { provider: 'claude', model: 'modele-codex' }), /Modèle « modele-codex » inconnu pour claude.*modele-claude/);
  const providers = await f.call('list_providers') as Array<{ provider: string; models: string[]; defaultModel: string }>;
  assert.deepEqual(providers.find(p => p.provider === 'codex')?.models, ['modele-codex']);
  assert.equal(providers.find(p => p.provider === 'codex')?.defaultModel, 'standard');
  const t = await f.start('Bon couple', { provider: 'codex', model: 'modèle codex' });
  assert.equal(t.model, 'modele-codex');
  f.turns.find(turn => turn.session === t.sessionId)!.end({ started: true, error: 'invalid model: modele-codex is not supported' });
  await flush();
  await f.tick(3000);
  const s = await f.state();
  assert.equal(s.threads.find(row => row.id === t.id)?.state, 'failed');
  assert.equal(s.threads.find(row => row.id === t.id)?.retries, 0);
  assert.equal(f.turns.filter(turn => turn.session === t.sessionId).length, 1);
  assert.ok(s.orchestrator.pending.some(event => event.type === 'thread_failed'));
});

test('Un fil prend par défaut le fournisseur du chat principal, sauf réglage contraire', async ctx => {
  const f = fixture(ctx);
  assert.equal((await f.state()).settings.defaultProvider, 'chat');
  f.service.updateSettings(f.root, { orchestratorProvider: 'codex' });
  f.user('Commence');
  await flush();
  assert.equal((await f.state()).orchestrator.chatProvider, 'codex');
  assert.equal((await f.start('Suit le chat')).provider, 'codex');
  assert.equal((await f.start('Choisi', { provider: 'claude' })).provider, 'claude');
  f.service.updateSettings(f.root, { defaultProvider: 'claude' });
  assert.equal((await f.start('Réglé', { provider: 'auto' })).provider, 'claude');
  assert.throws(() => f.service.updateSettings(f.root, { defaultProvider: 'auto' }), /Paramètres invalides/);
});

test('Un ancien réglage automatique des fils suit désormais le chat principal', async ctx => {
  const f = fixture(ctx);
  const file = path.join(f.root, '.piecemaker', 'orchestrateur', 'etat.json');
  f.service.updateSettings(f.root, { recycleAfter: 10 });
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  saved.settings.defaultProvider = 'auto';
  writeFileSync(file, JSON.stringify(saved));
  const again = createOrchestratorService(f.deps);
  ctx.after(() => again.stop());
  assert.equal((await again.state(f.root)).settings.defaultProvider, 'chat');
});
