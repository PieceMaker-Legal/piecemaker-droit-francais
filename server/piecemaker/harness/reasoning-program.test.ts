import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { createReasoningService } from '@/modules/piecemaker-reasoning/index.js';
import { createNormalizedMessage } from '@/shared/utils.js';

import { createCitationTurn } from './citation-turn.js';
import { createCitationStore } from './citation-store.js';
import { withCitationInstructions, withoutCitationInstructions } from './citation-instructions.js';
import { installChatCitationHarness } from './chat-harness.js';

function fixture(t: test.TestContext, folder: string) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE projects(project_id TEXT PRIMARY KEY, project_path TEXT);');
  db.prepare('INSERT INTO projects VALUES(?,?)').run('example', folder);
  const service = createReasoningService(() => db);
  t.after(() => db.close());
  return { service };
}

const fact = { id: 'F1', kind: 'fact', label: 'Valeur déclarée', value: 10, citations: [1] };

test('le contexte du programme est injecté et retiré de l’écho utilisateur avec les instructions', () => {
  const input = withCitationInstructions('Analyse ce dossier', 'Programme révision 2');
  assert.match(input, /Programme révision 2/);
  assert.equal(withoutCitationInstructions(input), 'Analyse ce dossier');
});

test('CITATIONS complet en fin de tour compile les assertions puis l’historique ne les rejoue pas', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pm-reasoning-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const { service } = fixture(t, cwd);
  const store = createCitationStore(path.join(cwd, '.snapshots'));
  await writeFile(path.join(cwd, 'piece.md'), 'Le montant facturé est de 12 000 euros.');
  const payload = `<CITATIONS>${JSON.stringify([
    { ref: 1, kind: 'document', doc_id: 'piece.md', quotes: [{ quote: 'Le montant facturé est de 12 000 euros.' }] },
    { kind: 'program', version: 1, nodes: [{ ...fact, value: 1200000 }] },
  ])}</CITATIONS>`;
  const turn = createCitationTurn({ cwd, sessionId: 's', store, onVerifiedTurn: service.ingest });
  let visible = '';
  for (const char of `Analyse [1].${payload}`) visible += turn.delta(char);
  visible += turn.flush();
  assert.equal(visible, 'Analyse [1].');
  assert.equal(service.read(cwd).revision, 0);
  assert.match(await turn.finish(), /Programme du dossier/);
  assert.equal(service.read(cwd).evaluations[0].results[0].value, 1200000);
  assert.ok(service.read(cwd).program.sources[0].token);
  const replay = createCitationTurn({ cwd, sessionId: 's', store, onVerifiedTurn: () => { throw new Error('Rejeu interdit'); }, recordVerification: false });
  replay.text(payload);
  await replay.finish();
  assert.equal(service.read(cwd).revision, 1);
});

test('le harnais injecte le programme au tour suivant et ne compile pas les réponses interrompues', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pm-reasoning-harness-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const { service } = fixture(t, cwd);
  const store = createCitationStore(path.join(cwd, '.snapshots'));
  const payload = `<CITATIONS>${JSON.stringify([{ kind: 'program', version: 1, nodes: [{ id: 'F_inconnu', kind: 'fact', label: 'À déterminer', state: 'unknown' }] }])}</CITATIONS>`;
  type Dependencies = Parameters<typeof installChatCitationHarness>[0];
  const commands: string[] = [];
  let aborted = true;
  const runtime: Dependencies['runtime'] = {
    run: async (_provider, command, _options, writer) => {
      commands.push(command);
      writer.send(createNormalizedMessage({ kind: 'stream_delta', provider: 'codex', role: 'assistant', content: payload }));
      writer.send(createNormalizedMessage({ kind: 'complete', provider: 'codex', aborted }));
    },
    getRunner: () => async () => {},
  };
  const sessions = { fetchHistory: async () => { throw new Error('Non utilisé'); }, getSessionDetailsById: () => { throw new Error('Non utilisé'); } } as Dependencies['sessions'];
  installChatCitationHarness({ runtime, sessions, store, ensureProxy: () => {}, onVerifiedTurn: service.ingest, programContext: service.context });
  await runtime.run('codex', 'Premier tour interrompu', { cwd, sessionId: 's' }, { send: () => {} });
  assert.equal(service.read(cwd).revision, 0);
  aborted = false;
  await runtime.run('codex', 'Formalise', { cwd, sessionId: 's' }, { send: () => {} });
  assert.equal(service.read(cwd).revision, 1);
  await runtime.run('codex', 'Récupère le résultat', { cwd, sessionId: 's' }, { send: () => {} });
  assert.match(commands[2], /État du programme après les tours précédents/);
  assert.match(commands[2], /F_inconnu/);
  assert.equal(service.read(cwd).revision, 2);
});
