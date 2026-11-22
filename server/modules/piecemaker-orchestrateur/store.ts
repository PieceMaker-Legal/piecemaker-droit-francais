import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, statfsSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Memory, ProjectState } from './types.js';

function initialState(): ProjectState {
  return {
    version: 1, revision: 0,
    settings: {
      instructions: '', defaultProvider: 'chat', orchestratorProvider: 'auto', orchestratorModel: '',
      defaultModels: {}, concurrency: { claude: 3, codex: 3, mistral: 3 }, folders: [], recycleAfter: 60,
    },
    threads: [], messages: [], decisions: [], schedules: [], deliverables: [], lookups: [],
    orchestrator: {
      chatSessionId: null, chatProvider: null, needsRecap: false, heldUpdates: [],
      sessionId: null, key: randomUUID(), provider: null, turns: 0, running: false, pending: [],
      holdingUntil: null, quietAt: null, lastUserAt: null, postsSinceUser: 0, userId: null, recaps: 0,
    },
  };
}

export function openProjectStore(root: string) {
  const directory = path.join(root, '.piecemaker', 'orchestrateur');
  const sharedFolder = path.join(directory, 'fichiers');
  mkdirSync(sharedFolder, { recursive: true });
  const file = (name: string) => path.join(directory, name);
  const read = (name: string) => readFileSync(file(name), 'utf8');
  function write(name: string, data: string) {
    writeFileSync(file(name + '.tmp'), data, { mode: 0o600 });
    renameSync(file(name + '.tmp'), file(name));
  }
  const state: ProjectState = existsSync(file('etat.json')) ? JSON.parse(read('etat.json')) : initialState();
  function save() {
    const revision = state.revision + 1;
    write('etat.json', JSON.stringify({ ...state, revision }, null, 2));
    state.revision = revision;
  }
  if ((state.settings.defaultProvider as string) === 'auto') state.settings.defaultProvider = 'chat';
  const orch = state.orchestrator;
  const legacy = orch.chatSessionId === undefined;
  if (legacy) {
    orch.chatSessionId = orch.sessionId;
    orch.chatProvider = orch.provider;
    if (orch.sessionId) orch.recoverPostsFrom = orch.sessionId;
    orch.heldUpdates = [];
  }
  if (legacy || orch.running) {
    orch.needsRecap = Boolean(orch.chatSessionId || orch.recaps);
    orch.sessionId = null;
    orch.provider = null;
    orch.turns = 0;
    orch.key = randomUUID();
  }
  let interrupted = state.orchestrator.running;
  state.orchestrator.running = false;
  for (const thread of state.threads) {
    if (thread.state !== 'working' && thread.state !== 'blocked') continue;
    interrupted = true;
    thread.state = 'failed';
    thread.error = 'Interrompu : serveur redémarré';
    thread.external = false;
    thread.pendingRequests = [];
  }
  if (interrupted) {
    for (const message of state.messages) {
      message.reactions = message.reactions.filter(r => r.by !== 'system' || r.emoji !== '👀');
      if (message.approval?.status === 'pending') message.approval.status = 'resolved';
    }
  }
  if (legacy || interrupted || !state.revision) save();

  function finishMemory({ text, revision, updatedAt }: Memory) {
    write('memoire.md', text);
    write('memoire.json', JSON.stringify({ revision, updatedAt }));
    unlinkSync(file('memoire.pending'));
  }
  if (existsSync(file('memoire.pending'))) finishMemory(JSON.parse(read('memoire.pending')));
  if (!existsSync(file('memoire.md'))) write('memoire.md', '');
  if (!existsSync(file('memoire.json'))) write('memoire.json', JSON.stringify({ revision: 0, updatedAt: null }));
  function memory(): Memory {
    return { ...JSON.parse(read('memoire.json')), text: read('memoire.md') };
  }
  return {
    state, sharedFolder, save, memory,
    files: () => readdirSync(sharedFolder).sort().flatMap(name => {
      const info = statSync(path.join(sharedFolder, name));
      return info.isFile() ? [{ name, size: info.size, updatedAt: info.mtime.toISOString() }] : [];
    }),
    storage() {
      const disk = statfsSync(sharedFolder);
      const used = readdirSync(sharedFolder).reduce((sum, name) => sum + statSync(path.join(sharedFolder, name)).size, 0);
      return { used, total: disk.blocks * disk.bsize };
    },
    addFile(name: string, content: Buffer) {
      const base = path.basename(name);
      if (!base || base.startsWith('.') || base !== name) throw Object.assign(new Error('Nom de fichier invalide.'), { code: 400 });
      writeFileSync(path.join(sharedFolder, base), content, { mode: 0o600 });
      return path.join(sharedFolder, base);
    },
    updateMemory(text: string, revision: number, updatedAt: string) {
      if (memory().revision !== revision) throw Object.assign(new Error('Révision de mémoire périmée.'), { code: 400 });
      const next = { text, revision: revision + 1, updatedAt };
      write('memoire.pending', JSON.stringify(next));
      finishMemory(next);
      return next;
    },
  };
}
