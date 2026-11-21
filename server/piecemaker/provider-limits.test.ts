import assert from 'node:assert/strict';
import test from 'node:test';

import { MISTRAL_LIMITS_MESSAGE, claudeWindows, codexWindows, createProviderLimits } from './provider-limits.js';

const connectedAll = async () => ['claude', 'codex', 'mistral'].map(provider => ({ provider, authenticated: true }));

test('Claude : fenêtres 5 h et hebdo lues dans /usage', () => {
  assert.deepEqual(claudeWindows({
    rate_limits_available: true,
    rate_limits: { five_hour: { utilization: 42, resets_at: '2026-11-21T13:00:00Z' }, seven_day: { utilization: 7.5, resets_at: null } },
  }), { windows: [
    { id: 'five_hour', usedPercent: 42, resetsAt: '2026-11-21T13:00:00.000Z' },
    { id: 'seven_day', usedPercent: 7.5, resetsAt: null },
  ] });
  assert.equal(claudeWindows({ rate_limits_available: false, rate_limits: null }).windows.length, 0);
});

test('Codex : fenêtre principale et secondaire classées par durée', () => {
  assert.deepEqual(codexWindows({ rateLimits: {
    primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1_795_000_000 },
    secondary: { usedPercent: 63, windowDurationMins: 10_080, resetsAt: null },
  } }), { windows: [
    { id: 'five_hour', usedPercent: 12, resetsAt: new Date(1_795_000_000_000).toISOString() },
    { id: 'seven_day', usedPercent: 63, resetsAt: null },
  ] });
});

test('seuls les comptes connectés sont lus, Mistral sans donnée 5 h ni hebdo, lecture en cache', async () => {
  let claudeReads = 0;
  const limits = createProviderLimits({
    connected: async () => [{ provider: 'claude', authenticated: true }, { provider: 'codex', authenticated: false }, { provider: 'mistral', authenticated: true }],
    readClaude: async () => { claudeReads++; return { rate_limits_available: true, rate_limits: { five_hour: { utilization: 10, resets_at: null } } }; },
    readCodex: async () => { throw new Error('jamais lu'); },
  });
  const first = await limits(1);
  assert.deepEqual(first, [
    { provider: 'claude', connected: true, windows: [{ id: 'five_hour', usedPercent: 10, resetsAt: null }] },
    { provider: 'codex', connected: false, windows: [] },
    { provider: 'mistral', connected: true, windows: [], message: MISTRAL_LIMITS_MESSAGE },
  ]);
  await limits(1);
  assert.equal(claudeReads, 1);
  await limits(1, true);
  assert.equal(claudeReads, 2);
});

test('une lecture en échec est signalée sans bloquer les autres providers', async () => {
  const limits = createProviderLimits({
    connected: connectedAll,
    readClaude: async () => { throw new Error('connexion refusée'); },
    readCodex: async () => ({ rateLimits: { primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: null }, secondary: null } }),
  });
  const [claude, codex] = await limits(1);
  assert.match(claude.message ?? '', /connexion refusée/);
  assert.deepEqual(codex.windows, [{ id: 'five_hour', usedPercent: 5, resetsAt: null }]);
});
