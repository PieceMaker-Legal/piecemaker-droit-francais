import assert from 'node:assert/strict';
import test from 'node:test';

import { detectQuotaLimit } from '../../shared/piecemaker/quota-limit.js';

const reference = new Date('2026-11-21T08:00:00Z');

test('reads the Claude banner reset time in its own time zone', () => {
  const limit = detectQuotaLimit("You've hit your limit · resets 3pm (Europe/Paris)", reference);
  assert.equal(limit?.resetAt?.toISOString(), '2026-11-21T14:00:00.000Z');
});

test('rolls a Claude reset already past to the next day', () => {
  const limit = detectQuotaLimit("You've hit your weekly limit · resets 7am (Europe/Paris)", reference);
  assert.equal(limit?.resetAt?.toISOString(), '2026-11-22T06:00:00.000Z');
});

test('reads a weekday and minutes in a Claude banner', () => {
  const limit = detectQuotaLimit('Weekly limit reached ∙ resets Mon 9:30am (America/New_York)', reference);
  assert.equal(limit?.resetAt?.toISOString(), '2026-11-23T14:30:00.000Z');
});

test('reads a month and day in a Claude banner', () => {
  const limit = detectQuotaLimit("You've hit your Opus limit · resets Nov 24, 10am (UTC)", reference);
  assert.equal(limit?.resetAt?.toISOString(), '2026-11-24T10:00:00.000Z');
});

test('reads the legacy Claude timestamp', () => {
  const limit = detectQuotaLimit('Claude AI usage limit reached|1795766400', reference);
  assert.equal(limit?.resetAt?.toISOString(), new Date(1795766400 * 1000).toISOString());
});

test('reads the Codex retry duration', () => {
  const limit = detectQuotaLimit("You've hit your usage limit. Upgrade to Pro or try again in 2 hours 5 minutes.", reference);
  assert.equal(limit?.resetAt?.toISOString(), '2026-11-21T10:05:00.000Z');
});

test('reads the Codex retry date', () => {
  const limit = detectQuotaLimit("You've hit your usage limit. Visit the usage page or try again at Nov 23rd, 2026 7:04 PM.", reference);
  const expected = new Date(2026, 10, 23, 19, 4);
  assert.equal(limit?.resetAt?.toISOString(), expected.toISOString());
});

test('keeps a Codex limit without a time', () => {
  const limit = detectQuotaLimit("You've hit your usage limit.", reference);
  assert.ok(limit);
  assert.equal(limit.resetAt, null);
});

test('recognises provider rate-limit errors without a reset time', () => {
  for (const text of ['API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}', 'Mistral: Rate limit exceeded', 'Service tier capacity exceeded for this model.']) {
    const limit = detectQuotaLimit(text, reference);
    assert.ok(limit, text);
    assert.equal(limit.resetAt, null);
  }
});

test('ignores ordinary replies', () => {
  for (const text of ["L'article 429 du code civil s'applique.", 'Le contrat prévoit une limite de responsabilité.', 'x'.repeat(900) + ' rate limit exceeded']) {
    assert.equal(detectQuotaLimit(text, reference), null, text.slice(0, 40));
  }
});
