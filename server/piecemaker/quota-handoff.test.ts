import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import express from 'express';

import { buildHandoffPrompt, createQuotaHandoffRouter } from './quota-handoff.js';

const turns: Array<Record<string, unknown>> = [];
let base = '';
let close = () => {};

before(async () => {
  const app = express();
  app.use(createQuotaHandoffRouter({
    source: (sessionId) => (sessionId === 'source' ? { provider: 'claude', projectPath: '/dossiers/Dupont' } : null),
    history: async () => [
      { role: 'user', text: 'Rédige les conclusions pour Jean Dupont.' },
      { role: 'assistant', text: 'Je commence par le plan.' },
      { role: 'assistant', text: "You've hit your limit · resets 3pm (Europe/Paris)" },
    ],
    openSession: (provider, projectPath) => `${provider}:${projectPath}`,
    runTurn: async (input) => {
      turns.push(input);
      return { started: true, error: null };
    },
    announce: () => {},
  }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});

after(() => close());

const post = (body: unknown) => fetch(`${base}/quota/handoff`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('le prompt de reprise reprend la fin de la conversation sans le message de limite', () => {
  const prompt = buildHandoffPrompt('codex', [
    { role: 'user', text: 'Analyse le bail.' },
    { role: 'assistant', text: "You've hit your usage limit. Try again in 2 hours." },
  ]);
  assert.match(prompt, /menée avec Codex/);
  assert.match(prompt, /\[Avocat\]\nAnalyse le bail\./);
  assert.doesNotMatch(prompt, /usage limit/);
});

test('ouvre une session chez le nouveau provider et y lance la reprise', async () => {
  const response = await post({ sessionId: 'source', provider: 'codex', model: 'gpt-5.5', permissionMode: 'acceptEdits' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sessionId: 'codex:/dossiers/Dupont' });
  const turn = turns.at(-1)!;
  assert.equal(turn.model, 'gpt-5.5');
  assert.equal(turn.permissionMode, 'acceptEdits');
  assert.match(String(turn.content), /Rédige les conclusions pour Jean Dupont\./);
  assert.match(String(turn.displayContent), /Claude, limite atteinte/);
});

test('refuse une session inconnue ou un provider invalide', async () => {
  assert.equal((await post({ sessionId: 'absente', provider: 'codex', model: 'gpt-5.5' })).status, 404);
  assert.equal((await post({ sessionId: 'source', provider: 'inconnu', model: 'x' })).status, 400);
});
