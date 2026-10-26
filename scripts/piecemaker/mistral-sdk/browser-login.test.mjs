import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { browserLogin } from './browser-login.mjs';

function fixture({ status = 'completed', origin = 'https://console.mistral.ai', expires = 60000, missingKey = false } = {}) {
  const calls = [];
  const opened = [];
  let time = 0;
  const responses = [
    { process_id: 'fictitious-process', sign_in_url: `${origin}/vibe/sign-in`, poll_url: `${origin}/api/vibe/sign-in/fictitious-process`, expires_at: new Date(expires).toISOString() },
    { status: 'pending' },
    { status, exchange_token: 'fictitious-exchange' },
    missingKey ? {} : { api_key: 'fictitious-key' },
  ];
  return {
    calls, opened,
    options: {
      fetchImpl: async (url, options) => { calls.push({ url, options }); return Response.json(responses.shift()); },
      openBrowser: async url => opened.push(url),
      sleep: async ms => { time += ms; },
      now: () => time,
    },
  };
}

test('browser approval exchanges the matching PKCE verifier for an SDK credential', async () => {
  const { options, calls, opened } = fixture();
  assert.equal(await browserLogin(options), 'fictitious-key');
  assert.deepEqual(opened, ['https://console.mistral.ai/vibe/sign-in']);
  const start = JSON.parse(calls[0].options.body);
  const exchange = JSON.parse(calls[3].options.body);
  assert.equal(start.code_challenge_method, 'S256');
  assert.equal(start.code_challenge, createHash('sha256').update(exchange.code_verifier).digest('base64url'));
  assert.equal(exchange.exchange_token, 'fictitious-exchange');
  assert.equal(calls[3].url, 'https://console.mistral.ai/api/vibe/sign-in/fictitious-process/exchange');
  assert.ok(calls.every(call => call.options.redirect === 'error'));
});

test('an unexpected login host is rejected before opening a browser or exchanging credentials', async () => {
  const { options, calls, opened } = fixture({ origin: 'https://example.test' });
  await assert.rejects(browserLogin(options), /Adresse/);
  assert.equal(calls.length, 1);
  assert.equal(opened.length, 0);
});

for (const status of ['denied', 'expired', 'error', 'unknown']) {
  test(`a ${status} sign-in never exchanges credentials`, async () => {
    const { options, calls } = fixture({ status });
    await assert.rejects(browserLogin(options), /refusée ou expirée/);
    assert.equal(calls.length, 3);
  });
}

test('expired login and missing credentials are reported without a false success', async () => {
  await assert.rejects(browserLogin(fixture({ expires: 1000 }).options), /expirée/);
  await assert.rejects(browserLogin(fixture({ missingKey: true }).options), /identifiants/);
});
