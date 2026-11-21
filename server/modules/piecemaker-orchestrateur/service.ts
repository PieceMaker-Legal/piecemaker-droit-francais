import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod/v4';

import { isImageAttachmentDescriptor } from '@/shared/image-attachments.js';

import { formatPreamble, formatThreadKickoff, formatThreadMessage, formatWake, isChatMessage } from './prompt.js';
import { openProjectStore } from './store.js';
import { RUNNABLE_PROVIDERS, THREAD_STATES } from './types.js';
import type {
  ChatMessage, Decision, Deliverable, OrchestratorDependencies, ProviderChoice, Reaction,
  Settings, Thread, ThreadReply, TurnOptions, WakeEvent,
} from './types.js';

const SESSION_TITLE = 'PieceMaker Agent';
const ORCHESTRATOR_DENIED = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'mcp__fil'];

function refuse(code: 400 | 403 | 404, message: string): never {
  throw Object.assign(new Error(message), { code });
}

const string = z.string().trim().min(1);
const choice = z.enum(['auto', ...RUNNABLE_PROVIDERS]);
const index = z.number().int().nonnegative();
const outputs = z.array(z.object({ kind: z.enum(['file', 'artifact', 'link']), ref: string, title: string.optional() })).default([]);
const threadInput = z.object({ title: string, instructions: string, provider: choice.optional(), folder: string.optional() });
const contexts = z.array(string).default([]);
const widget = z.object({
  type: z.enum(['buttons', 'draft', 'comparison', 'steps']), title: string.optional(), body: z.string().optional(),
  buttons: z.array(z.object({ action_id: string, label: string, style: z.enum(['primary', 'secondary', 'danger']).optional() })).optional(),
  draft: z.object({ to: z.string().optional(), subject: z.string().optional(), body: z.string() }).optional(),
  rows: z.array(z.object({ label: string, cells: z.array(z.string()) })).optional(), columns: z.array(z.string()).optional(),
  steps: z.array(z.object({ label: string, status: z.enum(['todo', 'doing', 'done']) })).optional(),
});
const decisionInput = z.object({
  question: string, options: z.array(z.object({ label: string, consequence: string })).min(2).max(4),
  recommended: index, reason: string.optional(),
});
const settingsInput = z.strictObject({
  instructions: z.string(), orchestratorProvider: choice, orchestratorModel: z.string(), defaultProvider: choice,
  defaultModels: z.partialRecord(z.enum(RUNNABLE_PROVIDERS), string),
  concurrency: z.partialRecord(z.enum(RUNNABLE_PROVIDERS), z.number().int().positive()),
  folders: z.array(string), recycleAfter: z.number().int().positive(),
}).partial();
const deliverableInput = z.object({
  deliverable_id: string.optional(), thread_id: string.optional(), title: string.optional(),
  kind: z.enum(['document', 'piece', 'artifact']).optional(), ref: string.optional(),
  state: z.enum(['brouillon', 'a_relire']).optional(),
});
function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  return result.success ? result.data : refuse(400, 'Paramètres invalides : ' + result.error.message);
}
function canonical(folder: string): string {
  const absolute = path.resolve(folder);
  if (existsSync(absolute)) return realpathSync(absolute);
  return path.join(canonical(path.dirname(absolute)), path.basename(absolute));
}

const INVALID_MODEL = /model.{0,80}(invalid|unknown|not found|not supported|not exist|unavailable|does not have access)|(invalid|unknown|unsupported) model|modèle.{0,40}(inconnu|invalide|introuvable)/i;
const invalidModel = (error: string) => INVALID_MODEL.test(error);

function parseCron(expression: string) {
  const fields = expression.trim().split(/\s+/);
  const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  if (fields.length !== 5) refuse(400, 'Le cron exige cinq champs.');
  const values = fields.map((field, i) => {
    const set = new Set<number>();
    const [min, max] = ranges[i];
    for (const item of field.split(',')) {
      const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(item);
      if (!match) refuse(400, 'Champ cron invalide : ' + item);
      const [start, end] = match[1] === '*' ? [min, max] : match[1].split('-').map(Number);
      const step = Number(match[2] ?? 1);
      if (start < min || (end ?? start) > max || (end ?? start) < start || step < 1 || !Number.isSafeInteger(step)) {
        refuse(400, 'Valeur cron invalide : ' + item);
      }
      for (let n = start; n <= (end ?? start); n += step) set.add(i === 4 && n === 7 ? 0 : n);
    }
    return set;
  });
  const matchesDay = (date: Date) => {
    const day = values[2].has(date.getDate());
    const weekday = values[4].has(date.getDay());
    const matches = fields[2].startsWith('*') || fields[4].startsWith('*') ? day && weekday : day || weekday;
    return matches && values[3].has(date.getMonth() + 1);
  };
  const matches = (date: Date) => matchesDay(date) && values[1].has(date.getHours()) && values[0].has(date.getMinutes());
  return {
    matches,
    next(now: Date, lastFiredAt: string | null) {
      const candidate = new Date(Math.floor(now.getTime() / 60000) * 60000);
      if (lastFiredAt?.slice(0, 16) === candidate.toISOString().slice(0, 16)) candidate.setTime(candidate.getTime() + 60000);
      const lastYear = now.getFullYear() + 400;
      while (candidate.getFullYear() <= lastYear) {
        if (matches(candidate)) return candidate.toISOString();
        if (matchesDay(candidate)) candidate.setTime(candidate.getTime() + 60000);
        else if (!values[3].has(candidate.getMonth() + 1)) {
          candidate.setDate(1);
          candidate.setMonth(candidate.getMonth() + 1);
          candidate.setHours(0, 0, 0, 0);
        } else candidate.setHours(24, 0, 0, 0);
      }
      return null;
    },
  };
}

function projectService(root: string, deps: OrchestratorDependencies, central: boolean) {
  const store = openProjectStore(root);
  const { state, save } = store;
  const orch = state.orchestrator;
  const now = () => deps.now().toISOString();
  const later = (ms: number) => new Date(deps.now().getTime() + ms).toISOString();
  const find = <T extends { id: string }>(list: T[], value: unknown, name: string) =>
    list.find(row => row.id === value) ?? refuse(404, name + ' introuvable.');
  const message = (id: unknown) => find(state.messages, id, 'Message');
  const thread = (id: unknown) => find(state.threads, id, 'Fil');
  const decision = (id: unknown) => find(state.decisions, id, 'Décision');
  const active = (t: Thread) => t.state === 'working' || t.state === 'blocked';
  const runs = new Map<string, { reply?: ThreadReply }>();
  let manualRecycle = false;
  let initializing = false;
  let currentBatch: WakeEvent[] = [];
  let generation = 0;
  let retryAt = 0;
  const id = (prefix: string) => prefix + '_' + randomUUID();
  const dossiers = () => [...new Set(deps.approvedFolders().map(canonical))].filter(folder => folder !== root);
  function dossier(folder: string | undefined) {
    if (!folder) return refuse(400, 'Dossier requis : chaque fil travaille dans un seul dossier, choisi dans list_devices.');
    const wanted = path.isAbsolute(folder) ? canonical(folder) : null;
    const matches = dossiers().filter(known => known === wanted || (!wanted && path.basename(known) === folder));
    return matches.length === 1 ? matches[0] : refuse(400, `Dossier « ${folder} » inconnu ou ambigu. Choisissez un dossier de list_devices, par son chemin.`);
  }
  function fence(own: string) {
    return dossiers().filter(other => other.startsWith('/') && other !== own && !own.startsWith(other + path.sep))
      .flatMap(other => [`Read(/${other}/**)`, `Edit(/${other}/**)`]);
  }
  function add(author: ChatMessage['author'], text: string, extra: Partial<ChatMessage> = {}) {
    const row: ChatMessage = { id: id('msg'), author, text, at: now(), attachments: [], decisionIds: [], reactions: [], ...extra };
    state.messages.push(row);
    if (author === 'orchestrator') {
      orch.postsSinceUser++;
      orch.holdingUntil = null;
      orch.heldUpdates = [];
    }
    return row;
  }
  function reaction(row: ChatMessage, by: Reaction['by'], emoji: string, on: boolean) {
    row.reactions = row.reactions.filter(r => r.by !== by || r.emoji !== emoji);
    if (on) row.reactions.push({ by, emoji });
  }
  function wake(type: WakeEvent['type'], trust: WakeEvent['trust'], text: string, extra: Partial<WakeEvent> = {}) {
    orch.pending.push({ type, trust, text, at: now(), ...extra });
    save();
    if (orch.chatSessionId && ['message', 'decision', 'widget_action'].includes(type)) deps.chatChanged(orch.chatSessionId);
    queueMicrotask(pump);
  }
  async function provider(choice: ProviderChoice) {
    const available = await deps.providers(orch.userId);
    return RUNNABLE_PROVIDERS.find(p => (choice === 'auto' || choice === p) && available.some(s => s.provider === p && s.authenticated))
      ?? refuse(400, 'Fournisseur déconnecté. Utilisez suggest_connectors.');
  }
  async function knownModel(p: (typeof RUNNABLE_PROVIDERS)[number], model: string) {
    const models = await deps.models(p);
    if (!models.length) return model;
    const wanted = model.trim().toLowerCase();
    return models.find(m => m.value.toLowerCase() === wanted || m.label.toLowerCase() === wanted)?.value
      ?? refuse(400, `Modèle « ${model} » inconnu pour ${p}. Modèles disponibles : ${models.map(m => m.value).join(', ')}.`);
  }
  let recovery: Promise<void> | undefined;
  function recoverPreviousPosts() {
    const sessionId = orch.recoverPostsFrom;
    if (!sessionId) return;
    recovery ??= deps.previousPostIds(sessionId).then(ids => {
      for (const message of state.messages) {
        if (message.author === 'orchestrator' && ids.has(message.id)) message.posted = true;
      }
      delete orch.recoverPostsFrom;
      save();
    }).catch(() => {}).finally(() => { recovery = undefined; });
    return recovery;
  }
  function resetSession() {
    generation++;
    Object.assign(orch, { key: randomUUID(), sessionId: null, turns: 0, provider: null, running: false, needsRecap: true, recaps: orch.recaps + 1 });
  }
  function ensureChat(p: TurnOptions['provider']) {
    if (!orch.chatSessionId) {
      orch.chatSessionId = deps.openSession(p, root, SESSION_TITLE);
      deps.chatChanged(orch.chatSessionId);
    }
    if (orch.chatProvider && orch.chatProvider !== p) deps.changeChatProvider(orch.chatSessionId, p);
    orch.chatProvider = p;
    return orch.chatSessionId;
  }
  function pump(startRecap = false) {
    if (!orch.running && (orch.pending.length || (orch.needsRecap && (startRecap || retryAt > 0))) && deps.now().getTime() >= retryAt) void orchestrate();
  }
  async function orchestrate() {
    generation++;
    const initialProvider = state.settings.orchestratorProvider;
    const recap = orch.needsRecap;
    const batch = recap ? [] : orch.pending.splice(0);
    currentBatch = batch;
    initializing = recap;
    const userMessages = batch.filter(e => e.type === 'message').map(e => message(e.messageId));
    orch.running = true;
    for (const row of userMessages) reaction(row, 'system', '👀', true);
    save();
    let launched = false;
    let rotate = false;
    try {
      if (recap) await recoverPreviousPosts();
      const p = orch.provider ?? await provider(initialProvider);
      const chatSessionId = ensureChat(p);
      const model = deps.sessionModel(chatSessionId) || state.settings.orchestratorModel || await deps.defaultModel(p);
      const permissions = await deps.permissions(p, orch.userId);
      const fresh = !orch.sessionId;
      orch.provider = p;
      orch.sessionId ??= deps.openSession(p, root, 'Coordination interne', true);
      save();
      const preamble = fresh || recap ? formatPreamble({ state, projectPath: root, memory: store.memory(), sharedFolder: store.sharedFolder, recycled: recap, dossiers: central ? state.settings.folders : undefined }) : '';
      const content = recap ? preamble : [preamble, formatWake({ ...orch, events: batch, now: deps.now() })].filter(Boolean).join('\n');
      launched = true;
      const result = await deps.runTurn(orch.sessionId, orch.userId, content, {
        attachments: userMessages.flatMap(row => row.uploads ?? []),
        provider: p, model, effort: null, permissionMode: 'default',
        allowedTools: [...new Set([...permissions.allowedTools.filter(tool => !ORCHESTRATOR_DENIED.includes(tool)), 'mcp__orchestrateur', 'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Skill'])],
        disallowedTools: [...new Set([...permissions.disallowedTools.filter(tool => tool !== 'mcp__orchestrateur'), ...ORCHESTRATOR_DENIED])],
      });
      if (!result.started) {
        orch.pending.unshift(...batch);
        retryAt = deps.now().getTime() + 10000;
      }
      if (result.error || !result.started) throw new Error(result.error ?? 'Tour non démarré.');
      if (recap) orch.needsRecap = false;
      else {
        orch.turns++;
        const ratio = await deps.contextRatio(orch.sessionId, p).catch(() => null);
        rotate = orch.turns >= state.settings.recycleAfter || (ratio !== null && ratio > 0.7);
      }
    } catch (error) {
      rotate = launched;
      if (!launched || recap) retryAt = deps.now().getTime() + 10000;
      if (!launched) orch.pending.unshift(...batch);
      const notice = "Échec du coordinateur : " + (error instanceof Error ? error.message : String(error));
      if (state.messages.at(-1)?.text !== notice) add('system', notice, launched ? {} : { connect: { target: initialProvider === 'auto' ? 'claude' : initialProvider, reconnect: false } });
    } finally {
      for (const row of userMessages) reaction(row, 'system', '👀', false);
      orch.running = false;
      initializing = false;
      currentBatch = [];
      if (rotate || manualRecycle || initialProvider !== state.settings.orchestratorProvider) resetSession();
      manualRecycle = false;
      save();
      pump(true);
    }
  }
  function userMessage(text: string, userId: number | null) {
    parse(string, text);
    const row = add('user', text);
    orch.userId = userId ?? orch.userId;
    if (orch.lastUserAt && deps.now().getTime() - Date.parse(orch.lastUserAt) > 1800000) orch.pending.push({ type: 'catch_up', trust: 'system', text: 'The user is back after more than 30 minutes. Post the results you are holding.', at: now() });
    orch.lastUserAt = row.at;
    orch.postsSinceUser = 0;
    retryAt = 0;
    orch.quietAt = state.threads.some(active) ? later(60000) : null;
    return row;
  }
  function threadWake(t: Thread, type: WakeEvent['type'], trust: WakeEvent['trust'], text: string) {
    wake(type, trust, text, { threadId: t.id, attrs: { title: t.title, state: t.state, ...(t.projectPath !== root ? { folder: t.projectPath } : {}) } });
  }
  function clearApprovals(t: Thread) {
    t.pendingRequests = [];
    for (const row of state.messages) {
      if (row.approval?.threadId === t.id && row.approval.status === 'pending') row.approval.status = 'resolved';
    }
  }
  function retry(t: Thread) {
    t.retries++;
    t.inbox.unshift('The previous turn was interrupted: ' + t.error + '. Pick up where you left off.');
    t.state = 'queued';
    threadWake(t, 'thread_retry', 'system', t.error ?? '');
  }
  function stopped(t: Thread) {
    runs.delete(t.id);
    clearApprovals(t);
    Object.assign(t, { state: 'stopped', updatedAt: now(), external: false });
    threadWake(t, 'thread_stopped', 'system', 'Thread stopped.');
  }
  async function finish(t: Thread, run: { reply?: ThreadReply }, error: string | null) {
    if (runs.get(t.id) !== run) return;
    let answer = '';
    try {
      if (t.sessionId && !error && !run.reply && !deps.wasAborted(t.sessionId)) answer = await deps.lastAnswer(t.sessionId);
    } catch (cause) { error = String(cause); }
    if (runs.get(t.id) !== run) return;
    runs.delete(t.id);
    t.updatedAt = now();
    t.external = false;
    clearApprovals(t);
    if (t.sessionId && deps.wasAborted(t.sessionId)) stopped(t);
    else if (error) {
      t.error = error;
      t.state = 'failed';
      if (!t.retries && !invalidModel(error)) retry(t);
      else threadWake(t, 'thread_failed', 'system', error);
    } else {
      const reply = run.reply ?? { at: now(), text: answer, outputs: [] };
      t.replies.push(reply);
      t.error = null;
      t.state = t.resolved ? 'done' : 'review_ready';
      threadWake(t, 'thread_reply', 'relay', reply.text);
      if (t.inbox.length) t.state = 'queued';
    }
    save();
    drain();
  }
  async function launch(t: Thread) {
    const run = {};
    runs.set(t.id, run);
    t.state = 'working';
    t.updatedAt = now();
    const count = t.inbox.length;
    save();
    let error: string | null = null;
    try {
      const permissions = await deps.permissions(t.provider, orch.userId);
      if (runs.get(t.id) !== run) return;
      t.sessionId ??= deps.openSession(t.provider, t.projectPath, t.title);
      const content = t.inbox.splice(0, count).join('\n\n');
      save();
      const options: TurnOptions = {
        provider: t.provider, model: t.model, effort: t.effort, permissionMode: 'bypassPermissions',
        allowedTools: [...permissions.allowedTools.filter(v => v !== 'mcp__orchestrateur'), 'mcp__fil'],
        disallowedTools: [...permissions.disallowedTools.filter(v => v !== 'mcp__fil'), 'mcp__orchestrateur', 'AskUserQuestion', 'ExitPlanMode',
          ...(central && t.provider === 'claude' ? fence(t.projectPath) : [])],
      };
      const result = await deps.runTurn(t.sessionId, orch.userId, content, options);
      error = result.error || (!result.started ? 'Tour non démarré.' : null);
    } catch (cause) { error = String(cause); }
    await finish(t, run, error);
  }
  function allowed(folder: string) {
    return [...(central ? [] : [root]), ...state.settings.folders].some(f => f === canonical(folder));
  }
  function drain() {
    for (const t of state.threads.filter(t => t.state === 'queued').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) {
      if (!allowed(t.projectPath) || state.messages.some(m => m.folderRequest?.threadId === t.id && m.folderRequest.status === 'pending')) continue;
      const busy = state.threads.filter(other => active(other) && other.provider === t.provider).length;
      if (busy < state.settings.concurrency[t.provider]) void launch(t);
    }
  }
  function cited(ids: string[]) {
    return ids.map(id => {
      const row = message(id);
      return row.author === 'user' ? row : refuse(400, "Seuls les messages de l'avocat peuvent être cités.");
    });
  }
  const startInput = threadInput.extend({
    ack_project: string, ack_thread: string, context_message_ids: contexts, model: string.optional(),
    effort: string.optional(),
  });
  async function prepareThread(input: z.input<typeof startInput>, projectInstructions = state.settings.instructions) {
    const args = parse(startInput, input);
    const p = await provider(args.provider === 'auto' || !args.provider ? state.settings.defaultProvider : args.provider);
    const model = args.model ? await knownModel(p, args.model) : state.settings.defaultModels[p] ?? await deps.defaultModel(p);
    const t: Thread = {
      id: id('thr'), key: randomUUID(), sessionId: null, title: args.title, instructions: args.instructions,
      projectPath: central ? dossier(args.folder) : canonical(path.resolve(root, args.folder ?? '.')), provider: p, model, effort: args.effort ?? null,
      ackProject: args.ack_project, ackThread: args.ack_thread, state: 'queued', resolved: false,
      createdAt: now(), updatedAt: now(), reminderAt: null, retries: 0, error: null,
      replies: [], pendingRequests: [], inbox: [], external: false,
    };
    t.inbox.push(formatThreadKickoff({ thread: t, key: t.key, cited: cited(args.context_message_ids), sharedFolder: store.sharedFolder, projectInstructions, dossier: central ? t.projectPath : undefined }));
    return t;
  }
  function addThread(t: Thread) {
    state.threads.push(t);
    add('orchestrator', t.ackProject, { threadId: t.id });
    if (!allowed(t.projectPath)) add('system', 'Autoriser l’accès au dossier ?', { folderRequest: { threadId: t.id, folder: t.projectPath, status: 'pending' } });
  }
  async function startThread(input: z.input<typeof startInput>, check = () => {}) {
    const t = await prepareThread(input);
    check();
    addThread(t);
    save();
    drain();
    return { thread_id: t.id, state: t.state };
  }
  function send(t: Thread, text: string) {
    t.inbox.push(text);
    t.resolved = false;
    if (!active(t) && t.state !== 'queued') {
      t.state = 'queued';
      t.updatedAt = now();
    }
    save();
    drain();
  }
  function buildDeliverable(args: z.output<typeof deliverableInput>) {
    const previous = args.deliverable_id ? find(state.deliverables, args.deliverable_id, 'Livrable') : undefined;
    const ref = args.ref ?? previous?.ref ?? refuse(400, 'Référence du livrable requise.');
    const kind = args.kind ?? previous?.kind ?? 'document';
    const owner = args.thread_id ?? previous?.threadId;
    const base = central && owner ? thread(owner).projectPath : root;
    if (kind !== 'artifact' && (path.isAbsolute(ref) || path.relative(base, canonical(path.resolve(base, ref))).split(path.sep)[0] === '..')) refuse(400, 'Chemin relatif au dossier requis.');
    const row: Deliverable = {
      id: previous?.id ?? id('liv'), ref, kind, title: args.title ?? previous?.title ?? path.basename(ref),
      threadId: args.thread_id ?? previous?.threadId ?? null, state: args.state ?? previous?.state ?? 'brouillon', updatedAt: now(),
    };
    return row;
  }
  function applySettings(input: unknown, principal: boolean) {
    const patch = parse(settingsInput, input);
    if (patch.folders) {
      patch.folders = [...new Set(patch.folders.map(folder => central ? dossier(folder) : canonical(path.resolve(root, folder))))];
      if (!principal && patch.folders.some(folder => !allowed(folder))) refuse(403, "L'accès aux dossiers exige l'accord de l'avocat.");
    }
    const settings = state.settings;
    const providerChanged = patch.orchestratorProvider && settings.orchestratorProvider !== patch.orchestratorProvider;
    Object.assign(settings, { ...patch, concurrency: { ...settings.concurrency, ...patch.concurrency }, defaultModels: { ...settings.defaultModels, ...patch.defaultModels } });
    if (providerChanged && orch.chatSessionId && !orch.running) {
      resetSession();
      queueMicrotask(() => pump(true));
    }
    save();
    drain();
    return settings;
  }
  function resolveThread(threadId: string, resolved: boolean) {
    const t = thread(threadId);
    t.resolved = parse(z.boolean(), resolved);
    if (!active(t)) t.state = resolved ? 'done' : 'review_ready';
    t.updatedAt = now();
    save();
    return { thread_id: t.id, resolved };
  }
  function ask(input: unknown, owner: Decision['owner']) {
    const args = parse(decisionInput, input);
    if (args.recommended >= args.options.length) refuse(400, 'Option recommandée invalide.');
    const d: Decision = { ...args, id: id('dec'), owner, at: now(), chosen: null, withdrawn: false, closedBy: null };
    state.decisions.push(d);
    if (owner === 'orchestrator') {
      add('orchestrator', d.question, { decisionIds: [d.id] });
    } else wake('thread_decision', 'relay', d.question, { threadId: owner.threadId, attrs: { decision_id: d.id } });
    return { decision_id: d.id };
  }
  function close(d: Decision, option: unknown, by: 'user' | 'orchestrator') {
    if (d.closedBy) refuse(400, 'Décision déjà fermée.');
    const chosen = option === undefined && by === 'orchestrator' ? null : parse(index.max(d.options.length - 1), option);
    Object.assign(d, { chosen, closedBy: by, withdrawn: chosen === null });
    const label = chosen === null ? 'Décision retirée.' : d.options[chosen].label;
    if (d.owner !== 'orchestrator') send(thread(d.owner.threadId), formatThreadMessage({ from: 'decision', text: label, cited: [] }));
    if (by === 'user') wake('decision', 'principal', label, { attrs: { decision_id: d.id }, threadId: d.owner === 'orchestrator' ? undefined : d.owner.threadId });
    save();
    return d;
  }
  function pollApprovals(t: Thread) {
    if (!t.sessionId) return;
    const requests = deps.pending(t.sessionId);
    const ids = requests.map(r => r.requestId);
    if (ids.length === t.pendingRequests.length && ids.every(value => t.pendingRequests.includes(value))) return;
    for (const m of state.messages) {
      const a = m.approval;
      if (a?.threadId === t.id && a.status === 'pending' && !ids.includes(a.requestId)) a.status = 'resolved';
    }
    t.state = ids.length ? 'blocked' : 'working';
    for (const r of requests.filter(r => !t.pendingRequests.includes(r.requestId))) {
      const row = add('system', r.toolName, { approval: { ...r, threadId: t.id, status: 'pending' } });
      wake('thread_blocked', 'system', r.toolName, { messageId: row.id, threadId: t.id });
      deps.notify(orch.userId, t.sessionId, t.title, r.toolName);
    }
    t.pendingRequests = ids;
    save();
  }
  function tick() {
    const date = deps.now();
    const stamp = date.toISOString();
    for (const [key, type] of [['quietAt', 'quiet'], ['holdingUntil', 'time_limit']] as const) {
      if (orch[key] && orch[key] <= stamp) {
        orch[key] = null;
        wake(type, 'system', type === 'quiet' ? 'The user may be waiting for an answer.' : 'Post the results you are holding.');
      }
    }
    for (const t of state.threads) {
      if (t.reminderAt && t.reminderAt <= stamp) {
        t.reminderAt = null;
        threadWake(t, 'reminder', 'system', t.title);
      }
      if (t.state === 'failed' && !t.retries && !invalidModel(t.error ?? '')) retry(t);
      if (!t.sessionId) continue;
      const processing = deps.isProcessing(t.sessionId);
      if (!active(t) && processing && !runs.has(t.id)) {
        t.external = true;
        t.state = 'working';
        t.updatedAt = stamp;
        runs.set(t.id, {});
        save();
      }
      if (!active(t)) continue;
      pollApprovals(t);
      if (t.external && !processing) {
        t.external = false;
        const run = runs.get(t.id);
        if (run) void finish(t, run, null);
      }
    }
    for (const schedule of state.schedules) {
      if (schedule.kind === 'once' && !schedule.lastFiredAt && schedule.at && schedule.at <= stamp) {
        schedule.lastFiredAt = stamp;
        wake('send_later', 'system', schedule.text);
      }
      if (schedule.kind === 'cron' && schedule.thread && schedule.cron &&
          schedule.lastFiredAt?.slice(0, 16) !== stamp.slice(0, 16) && parseCron(schedule.cron).matches(date)) {
        schedule.lastFiredAt = stamp;
        save();
        const input = schedule.thread;
        void startThread({ ...input, ack_project: input.title, ack_thread: input.title })
          .then(result => wake('routine', 'system', input.title, { threadId: result.thread_id }))
          .catch(error => wake('routine', 'system', String(error)));
      }
    }
    drain();
    pump();
  }
  async function lookup(question: string, check: () => void) {
    const p = await provider(state.settings.orchestratorProvider);
    const model = await deps.defaultModel(p, 'lookup');
    check();
    const sessionId = deps.openSession(p, root, 'Recherche rapide');
    const lookupId = id('lookup');
    state.lookups.push({ id: lookupId, sessionId, question, at: now() });
    const options = { provider: p, model, effort: null, permissionMode: 'plan',
      allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
      disallowedTools: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'mcp__fil', 'mcp__orchestrateur'] };
    async function search() {
      let answer: string;
      try {
        const result = await deps.runTurn(sessionId, orch.userId, question, options);
        answer = result.error ?? (result.started ? await deps.lastAnswer(sessionId) : 'Recherche non démarrée.');
      } catch (error) { answer = String(error); }
      wake('lookup_result', 'relay', answer, { attrs: { lookup_id: lookupId, question } });
    }
    void search();
    return { lookup_id: lookupId };
  }
  function threadCall(t: Thread, tool: string, args: Record<string, unknown>) {
    switch (tool) {
      case 'reply': {
        const { text, attached_outputs } = parse(z.object({ text: string, attached_outputs: outputs }), args);
        let run = runs.get(t.id);
        if (!run && t.sessionId && deps.isProcessing(t.sessionId)) {
          tick();
          run = runs.get(t.id);
        }
        if (!run) refuse(400, 'Aucun tour en cours pour ce fil.');
        const deliverables = attached_outputs.filter(output => output.kind !== 'link').map(output =>
          buildDeliverable({ kind: output.kind === 'file' ? 'document' : 'artifact',
            ref: output.ref, title: output.title, state: 'a_relire', thread_id: t.id }));
        state.deliverables.push(...deliverables);
        run.reply = { text, at: now(), outputs: attached_outputs };
        return { thread_id: t.id };
      }
      case 'ask_decision': return ask(args, { threadId: t.id });
      case 'message_orchestrator':
        threadWake(t, 'thread_message', 'relay', parse(string, args.text));
        return { thread_id: t.id };
      default: return refuse(403, 'Outil interdit pour un fil.');
    }
  }
  function summary(t: Thread) {
    return { thread_id: t.id, title: t.title, folder: t.projectPath, state: t.state, provider: t.provider, model: t.model, effort: t.effort,
      updated_at: t.updatedAt, resolved: t.resolved, deliverables: state.deliverables.filter(d => d.threadId === t.id) };
  }
  async function orchestratorCall(tool: string, args: Record<string, unknown>, check: () => void) {
    const target = () => thread(args.thread_id);
    switch (tool) {
      case 'post_message': {
        const data = parse(z.object({ text: z.string().refine(text => Boolean(text.trim())), attached_outputs: outputs, decision_ids: contexts, notify: z.boolean().optional() }), args);
        data.decision_ids.forEach(decision);
        const row = add('orchestrator', data.text, { posted: true, attachments: data.attached_outputs, decisionIds: data.decision_ids, notify: data.notify });
        if (row.notify) deps.notify(orch.userId, orch.chatSessionId, 'Projet', row.text);
        return { message_id: row.id };
      }
      case 'edit_message': {
        const row = message(args.message_id);
        if (row.author !== 'orchestrator') refuse(403, 'Seul un post de l’orchestrateur peut être corrigé.');
        row.text = parse(string, args.text);
        row.editedAt = now();
        return { message_id: row.id };
      }
      case 'react': case 'unreact': {
        const row = message(args.message_id);
        reaction(row, 'orchestrator', parse(string, args.emoji), tool === 'react');
        return { message_id: row.id };
      }
      case 'post_widget': return { message_id: add('orchestrator', '', { widget: parse(widget, args) }).id };
      case 'update_widget': {
        const card = message(args.message_id).widget ?? refuse(400, 'Carte widget requise.');
        Object.assign(card, parse(widget.pick({ steps: true, body: true }), args));
        return { message_id: args.message_id };
      }
      case 'ask_decision': return ask(args, 'orchestrator');
      case 'close_decision': return close(decision(args.decision_id), args.chose, 'orchestrator');
      case 'post_thread_card': {
        const d = decision(args.decision_id);
        if (d.owner === 'orchestrator') refuse(400, 'Décision de fil requise.');
        return { message_id: add('orchestrator', parse(string.optional(), args.text) ?? d.question, { decisionIds: [d.id], threadId: d.owner.threadId }).id };
      }
      case 'start_thread': return startThread(parse(startInput, args), check);
      case 'message_thread': {
        const t = target();
        send(t, formatThreadMessage({ from: 'orchestrator', text: parse(string, args.text), cited: cited(parse(contexts, args.context_message_ids)) }));
        return summary(t);
      }
      case 'read_thread': {
        const t = target();
        const limit = parse(index.positive().default(20), args.limit);
        const rows = t.sessionId ? await deps.history(t.sessionId, limit) : [];
        return { ...summary(t), replies: t.replies.slice(-limit), history: rows.map(row => ({ ...row, text: row.text.replaceAll(t.key, '[clé]') })) };
      }
      case 'list_threads': {
        const filter = parse(z.enum(THREAD_STATES).optional(), args.state);
        return state.threads.filter(t => !filter || t.state === filter).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(summary);
      }
      case 'rename_thread': {
        const t = target();
        t.title = parse(string, args.title);
        t.updatedAt = now();
        return summary(t);
      }
      case 'set_thread_resolved': return resolveThread(target().id, parse(z.boolean(), args.resolved));
      case 'set_thread_reminder': {
        const t = target();
        const days = parse(z.number().min(0).max(30), args.days);
        t.reminderAt = days ? later(days * 86400000) : null;
        return { thread_id: t.id, reminder_at: t.reminderAt };
      }
      case 'switch_model': {
        const t = target();
        const patch = parse(z.object({ model: string.optional(), effort: string.optional() }), args);
        if (patch.model) patch.model = await knownModel(t.provider, patch.model);
        Object.assign(t, patch);
        return summary(t);
      }
      case 'send_later': {
        const at = parse(z.iso.datetime({ offset: true }), args.at);
        const schedule = { id: id('timer'), kind: 'once' as const, text: parse(string, args.text), at: new Date(at).toISOString(), cron: null, thread: null, lastFiredAt: null, createdAt: now() };
        state.schedules.push(schedule);
        return { schedule_id: schedule.id };
      }
      case 'create_routine': {
        const cron = parse(string, args.cron);
        parseCron(cron);
        const input = parse(threadInput, args);
        const schedule = { id: id('routine'), kind: 'cron' as const, text: '', at: null, cron, thread: { ...input, provider: input.provider ?? 'auto' as const }, lastFiredAt: null, createdAt: now() };
        state.schedules.push(schedule);
        return { routine_id: schedule.id };
      }
      case 'delete_routine': {
        const routine = find(state.schedules.filter(s => s.kind === 'cron'), args.routine_id, 'Routine');
        state.schedules.splice(state.schedules.indexOf(routine), 1);
        return { routine_id: routine.id };
      }
      case 'list_routines': return state.schedules.filter(s => s.kind === 'cron');
      case 'lookup': return lookup(parse(string, args.question), check);
      case 'read_memory': return store.memory();
      case 'update_memory': return store.updateMemory(parse(z.string(), args.text), parse(index, args.revision), now());
      case 'get_project_settings': return state.settings;
      case 'update_project_settings': {
        const names: Record<string, keyof Settings> = { orchestrator_provider: 'orchestratorProvider', orchestrator_model: 'orchestratorModel', default_provider: 'defaultProvider', default_models: 'defaultModels', recycle_after: 'recycleAfter' };
        return applySettings(Object.fromEntries(Object.entries(args).map(([key, value]) => [names[key] ?? key, value])), false);
      }
      case 'list_providers': return Promise.all((await deps.providers(orch.userId)).map(async status => ({
        ...status, models: (await deps.models(status.provider)).map(m => m.value), defaultModel: state.settings.defaultModels[status.provider] ?? await deps.defaultModel(status.provider),
      })));
      case 'list_devices': return (central ? dossiers() : [...new Set([root, ...state.settings.folders, ...deps.approvedFolders()].map(canonical))]).map(folder => ({ folder, allowed: allowed(folder) }));
      case 'suggest_connectors': {
        const connect = parse(z.object({ target: string, reconnect: z.boolean().default(false), reason: string.optional() }), args);
        return { message_id: add('orchestrator', connect.reason ?? '', { connect }).id };
      }
      case 'list_thread_connectors': {
        const t = target();
        if (!allowed(t.projectPath)) refuse(403, 'Dossier non autorisé.');
        return deps.connectors(t.projectPath);
      }
      case 'list_project_artifacts': return deps.artifacts(root);
      case 'list_deliverables': return state.deliverables;
      case 'update_deliverable': {
        const row = buildDeliverable(parse(deliverableInput, args));
        const previous = state.deliverables.find(d => d.id === row.id);
        if (previous) Object.assign(previous, row);
        else state.deliverables.push(row);
        return row;
      }
      case 'propose_project_setup': {
        const input = parse(z.object({ instructions: string.optional(), threads: z.array(threadInput) }), args);
        return { message_id: add('orchestrator', '', { setup: { ...input, status: 'pending' } }).id };
      }
      case 'no_reply_needed': {
        const reason = parse(z.enum(['nothing_to_add', 'not_for_me', 'holding_updates']), args.reason);
        if (reason === 'holding_updates') {
          orch.holdingUntil ??= later(600000);
          orch.heldUpdates.push(...currentBatch.filter(event => !orch.heldUpdates.includes(event)));
        }
        return { reason };
      }
      default: return refuse(403, 'Outil interdit pour l’orchestrateur.');
    }
  }
  return {
    tick,
    cancelScheduled(kind: unknown, id: unknown) {
      if (kind === 'reminder') thread(id).reminderAt = null;
      else {
        if (kind !== 'once' && kind !== 'cron') refuse(400, 'Type de tâche inconnu.');
        const schedule = find(state.schedules.filter(item => item.kind === kind), id, 'Tâche');
        state.schedules.splice(state.schedules.indexOf(schedule), 1);
      }
      save();
      return { ok: true };
    },
    async state(userId: number | null) {
      const providers = await deps.providers(userId);
      const date = deps.now();
      const schedules = state.schedules.map(schedule => ({
        ...schedule,
        nextRunAt: schedule.cron ? parseCron(schedule.cron).next(date, schedule.lastFiredAt) : schedule.lastFiredAt ? null : schedule.at,
      }));
      return structuredClone({ ...state, schedules, providers, memory: store.memory(), artifacts: deps.artifacts(root), files: store.files(), storage: store.storage(),
        central, dossiers: central ? dossiers().map(folder => ({ path: folder, selected: allowed(folder) })) : [] });
    },
    postUserMessage(text: string, userId: number | null, uploads?: ChatMessage['uploads']) {
      const row = userMessage(text, userId);
      if (uploads?.length) row.uploads = uploads;
      wake('message', 'principal', row.text, { messageId: row.id });
      return row;
    },
    async session(userId: number | null) {
      if (userId !== null && userId !== orch.userId) {
        orch.userId = userId;
        save();
      }
      if (!orch.chatSessionId) {
        const p = await provider(state.settings.orchestratorProvider);
        if (!orch.chatSessionId) ensureChat(p);
        save();
      }
      return { sessionId: orch.chatSessionId, provider: orch.chatProvider };
    },
    sessionId: () => orch.chatSessionId,
    async chatHistory() {
      await recoverPreviousPosts();
      return state.messages.filter(isChatMessage).map(m => {
        const decisions = state.decisions.filter(d => m.decisionIds.includes(d.id));
        const card = m.widget || decisions.length || m.attachments.length ? { widget: m.widget, decisions, outputs: m.attachments, messageId: m.id } : undefined;
        return {
          id: m.id, timestamp: m.at, sessionId: orch.chatSessionId!, provider: orch.chatProvider!,
          role: m.author === 'user' ? 'user' as const : 'assistant' as const, kind: 'text' as const,
          content: !m.posted && decisions.some(d => d.question === m.text) ? '' : m.text,
          images: m.uploads?.filter(isImageAttachmentDescriptor), files: m.uploads?.filter(file => !isImageAttachmentDescriptor(file)),
          agentCard: card,
        };
      });
    },
    async call(key: string, tool: string, input: unknown) {
      const threadOwner = state.threads.find(t => t.key === key);
      const token = generation;
      const check = () => {
        if (initializing || orch.key !== key || !orch.running || token !== generation) refuse(403, 'Clé de session invalide ou orchestrateur inactif.');
      };
      if (!threadOwner) check();
      const args = parse(z.record(z.string(), z.unknown()), input);
      const result = threadOwner ? threadCall(threadOwner, tool, args) : await orchestratorCall(tool, args, check);
      if (!tool.startsWith('list_') && !tool.startsWith('read_') && !tool.startsWith('get_')) save();
      if (orch.chatSessionId && ['post_message', 'edit_message', 'post_widget', 'update_widget', 'ask_decision', 'post_thread_card', 'close_decision'].includes(tool)) deps.chatChanged(orch.chatSessionId);
      return structuredClone(result);
    },
    chooseDecision: (decisionId: string, option: number) => close(decision(decisionId), option, 'user'),
    widgetAction(messageId: string, actionId: string, text?: string) {
      const card = message(messageId).widget ?? refuse(400, 'Carte widget requise.');
      actionId = parse(string, actionId);
      if (card.type === 'buttons' && !card.buttons?.some(b => b.action_id === actionId)) refuse(400, 'Bouton inconnu.');
      card.state = { clicked: actionId, text, at: now() };
      wake('widget_action', 'principal', text ?? actionId, { messageId, attrs: { action_id: actionId } });
      return card.state;
    },
    approval(messageId: string, allow: boolean) {
      parse(z.boolean(), allow);
      const a = message(messageId).approval;
      if (!a || a.status !== 'pending') refuse(400, 'Autorisation absente ou déjà traitée.');
      const t = thread(a.threadId);
      if (!t.sessionId || !deps.pending(t.sessionId).some(r => r.requestId === a.requestId)) refuse(400, 'Autorisation expirée.');
      deps.resolve(a.requestId, allow);
      a.status = allow ? 'allowed' : 'denied';
      pollApprovals(t);
      wake('approval', 'principal', a.status, { messageId, threadId: t.id });
      return a;
    },
    folder(messageId: string, allow: boolean) {
      parse(z.boolean(), allow);
      const request = message(messageId).folderRequest;
      if (!request || request.status !== 'pending') refuse(400, 'Demande de dossier absente ou déjà traitée.');
      request.status = allow ? 'allowed' : 'denied';
      if (allow && !state.settings.folders.includes(request.folder)) state.settings.folders.push(request.folder);
      if (!allow && request.threadId) stopped(thread(request.threadId));
      wake('folder_access', 'principal', request.folder, { messageId, threadId: request.threadId ?? undefined, attrs: { status: request.status } });
      drain();
      return request;
    },
    async setup(messageId: string, accept: boolean) {
      parse(z.boolean(), accept);
      const proposal = message(messageId).setup;
      if (!proposal || proposal.status !== 'pending') refuse(400, 'Proposition absente ou déjà traitée.');
      const prepared = accept ? await Promise.all(proposal.threads.map(t =>
        prepareThread({ ...t, ack_project: t.title, ack_thread: t.title }, proposal.instructions))) : [];
      if (proposal.status !== 'pending') refuse(400, 'Proposition déjà traitée.');
      proposal.status = accept ? 'accepted' : 'declined';
      if (accept && proposal.instructions) state.settings.instructions = proposal.instructions;
      prepared.forEach(addThread);
      wake('setup', 'principal', proposal.status, { messageId });
      drain();
      return proposal;
    },
    react(messageId: string, emoji: string, on: boolean) {
      const row = message(messageId);
      reaction(row, 'user', parse(string, emoji), parse(z.boolean(), on));
      wake('reaction', 'principal', emoji, { messageId, attrs: { on: String(on) } });
      return row.reactions;
    },
    addFile(name: unknown, content: unknown) {
      const data = parse(z.object({ name: string, content: z.string().max(20_000_000) }), { name, content });
      return { path: store.addFile(data.name, Buffer.from(data.content, 'base64')) };
    },
    updateSettings: (patch: unknown) => applySettings(patch, true),
    updateMemory: (text: string, revision: number) => store.updateMemory(parse(z.string(), text), parse(index, revision), now()),
    updateDeliverable(deliverableId: string, status: Deliverable['state']) {
      const row = find(state.deliverables, deliverableId, 'Livrable');
      row.state = parse(z.enum(['brouillon', 'a_relire', 'valide']), status);
      row.updatedAt = now();
      save();
      return row;
    },
    resolveThread,
    async stopThread(threadId: string) {
      const t = thread(threadId);
      const run = runs.get(t.id);
      if (active(t) && t.sessionId && !await deps.abort(t.provider, t.sessionId) && deps.isProcessing(t.sessionId)) refuse(400, 'Impossible d’arrêter le tour.');
      if (runs.get(t.id) === run && t.state !== 'stopped') stopped(t);
      drain();
      return summary(t);
    },
    recycle() {
      if (orch.running) manualRecycle = true;
      else {
        resetSession();
        save();
        pump(true);
      }
      return { recycled: true };
    },
  };
}

export function createOrchestratorService(deps: OrchestratorDependencies) {
  const projects = new Map<string, ReturnType<typeof projectService>>();
  let centralKey: string | null = null;
  function centralRoot() {
    if (!deps.centralRoot) return refuse(404, 'Agent central indisponible.');
    if (!centralKey) {
      mkdirSync(deps.centralRoot, { recursive: true });
      centralKey = canonical(deps.centralRoot);
    }
    return centralKey;
  }
  function project(root: string) {
    const key = canonical(root);
    let current = projects.get(key);
    if (!current) {
      current = projectService(key, deps, Boolean(deps.centralRoot) && key === centralRoot());
      projects.set(key, current);
    }
    return current;
  }
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    start() {
      if (timer) return;
      let loaded = false;
      const load = () => {
        try {
          for (const folder of [...deps.approvedFolders(), ...(deps.centralRoot ? [centralRoot()] : [])]) {
            if (existsSync(path.join(folder, '.piecemaker', 'orchestrateur', 'etat.json'))) project(folder);
          }
          loaded = true;
        } catch (error) {
          console.warn('[piecemaker] Orchestrateur : dossiers pas encore lisibles', error);
        }
      };
      load();
      timer = setInterval(() => {
        if (!loaded) load();
        for (const current of projects.values()) {
          try { current.tick(); } catch (error) { console.warn('[piecemaker] Orchestrateur :', error); }
        }
      }, 3000);
      timer.unref();
    },
    stop() { clearInterval(timer); timer = undefined; },
    centralRoot,
    isCentral: (root: string) => Boolean(deps.centralRoot) && canonical(root) === centralRoot(),
    central: () => ({ project: centralRoot(), sessionId: project(centralRoot()).sessionId() }),
    async centralSession(userId: number | null = null) {
      const root = centralRoot();
      return { project: root, ...await project(root).session(userId) };
    },
    state: (root: string, userId: number | null = null) => project(root).state(userId),
    async call(root: string, sessionKey: string, tool: string, args: unknown = {}) {
      const folder = canonical(root);
      if (!projects.has(folder) && !existsSync(path.join(folder, '.piecemaker', 'orchestrateur', 'etat.json'))) {
        refuse(403, 'Clé de session inconnue.');
      }
      return project(folder).call(sessionKey, tool, args);
    },
    postUserMessage: (root: string, text: string, userId: number | null = null, uploads?: ChatMessage['uploads']) => project(root).postUserMessage(text, userId, uploads),
    session: (root: string, userId: number | null = null) => project(root).session(userId),
    sessionId(root: string) {
      const folder = canonical(root);
      return projects.has(folder) || existsSync(path.join(folder, '.piecemaker', 'orchestrateur', 'etat.json')) ? project(folder).sessionId() : null;
    },
    chatHistory(root: string, sessionId: string) {
      return this.sessionId(root) === sessionId ? project(root).chatHistory() : null;
    },
    chooseDecision: (root: string, decisionId: string, option: number) => project(root).chooseDecision(decisionId, option),
    widgetAction: (root: string, messageId: string, actionId: string, text?: string) => project(root).widgetAction(messageId, actionId, text),
    approval: (root: string, messageId: string, allow: boolean) => project(root).approval(messageId, allow),
    folder: (root: string, messageId: string, allow: boolean) => project(root).folder(messageId, allow),
    setup: (root: string, messageId: string, accept: boolean) => project(root).setup(messageId, accept),
    react: (root: string, messageId: string, emoji: string, on: boolean) => project(root).react(messageId, emoji, on),
    addFile: (root: string, name: unknown, content: unknown) => project(root).addFile(name, content),
    updateSettings: (root: string, patch: unknown) => project(root).updateSettings(patch),
    updateMemory: (root: string, text: string, revision: number) => project(root).updateMemory(text, revision),
    updateDeliverable: (root: string, id: string, state: Deliverable['state']) => project(root).updateDeliverable(id, state),
    resolveThread: (root: string, threadId: string, resolved: boolean) => project(root).resolveThread(threadId, resolved),
    cancelScheduled: (root: string, kind: unknown, id: unknown) => project(root).cancelScheduled(kind, id),
    stopThread: (root: string, threadId: string) => project(root).stopThread(threadId),
    recycle: (root: string) => project(root).recycle(),
  };
}
