import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { installLegalCodeHarness, withLegalCodeInstructions, withoutLegalCodeInstructions } from '../legal-code-harness.js';

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'legal-code-'));
  fs.mkdirSync(path.join(root, 'server', 'piecemaker', 'legal-code'), { recursive: true });
  fs.writeFileSync(path.join(root, 'server', 'piecemaker', 'legal-code', 'instructions.md'), 'Tu es Legal Code.\n');
  const calls: string[] = [];
  const sent: any[] = [];
  const runtime: any = {
    run: async (_provider: string, command: string, _options: any, writer: any) => {
      calls.push(command);
      writer.send({ kind: 'text', role: 'user', content: command });
    },
  };
  const sessions: any = {
    fetchHistory: async () => ({ messages: [{ kind: 'text', role: 'user', content: calls[0] }] }),
  };
  installLegalCodeHarness({ runtime, sessions, applicationRoot: root });
  const writer: any = { send: (data: unknown) => sent.push(data) };
  return { runtime, sessions, calls, sent, writer };
}

test('ajoute les instructions au premier message Legal Code et les masque à l’affichage', async () => {
  const { runtime, sessions, calls, sent, writer } = setup();
  await runtime.run('claude', 'La clause est-elle valable ?', { legalCode: true, cwd: '/dossiers/Dupont c Exemple' }, writer);
  assert.match(calls[0], /Tu es Legal Code\./);
  assert.match(calls[0], /--dossier "\/dossiers\/Dupont c Exemple"/);
  assert.ok(calls[0].includes(`"${path.join('/dossiers/Dupont c Exemple', '.agents', 'skills', 'Skill-PieceMaker', 'scripts', 'pm')}"`));
  assert.equal(sent[0].content, 'La clause est-elle valable ?');
  const history = await sessions.fetchHistory('s1', {});
  assert.equal(history.messages[0].content, 'La clause est-elle valable ?');
});

test('une session classique n’est pas modifiée', async () => {
  const { runtime, calls, writer } = setup();
  await runtime.run('claude', 'Bonjour', {}, writer);
  assert.equal(calls[0], 'Bonjour');
});

test('le retrait laisse intact un message sans instructions', () => {
  assert.equal(withoutLegalCodeInstructions('Bonjour'), 'Bonjour');
  assert.equal(withoutLegalCodeInstructions(withLegalCodeInstructions('Bonjour', 'X')), 'Bonjour');
});
