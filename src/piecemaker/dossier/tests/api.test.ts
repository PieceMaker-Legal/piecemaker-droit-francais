import assert from 'node:assert/strict';

import { beforeEach, test, vi } from 'vitest';

const { authenticatedFetch } = vi.hoisted(() => ({
  authenticatedFetch: vi.fn(),
}));

vi.mock('@/shared/api', () => ({ authenticatedFetch }));

import { invalidatePmGet, pmGetCached } from '@/piecemaker/dossier/api';

beforeEach(() => {
  authenticatedFetch.mockReset();
});

test('shares a pending PieceMaker GET request and its resolved result', async () => {
  authenticatedFetch.mockResolvedValue(new Response(JSON.stringify({ value: 1 }), { status: 200 }));

  const first = pmGetCached<{ value: number }>('/cache-test-shared');
  const second = pmGetCached<{ value: number }>('/cache-test-shared');

  assert.equal(first, second);
  assert.deepEqual(await first, { value: 1 });
  assert.deepEqual(await pmGetCached('/cache-test-shared'), { value: 1 });
  assert.equal(authenticatedFetch.mock.calls.length, 1);
});

test('reloads a PieceMaker GET request after explicit invalidation', async () => {
  authenticatedFetch
    .mockResolvedValueOnce(new Response(JSON.stringify({ value: 1 }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ value: 2 }), { status: 200 }));

  assert.deepEqual(await pmGetCached('/cache-test-refresh', { case: 'case-1' }), { value: 1 });
  invalidatePmGet('/cache-test-refresh', { case: 'case-1' });
  assert.deepEqual(await pmGetCached('/cache-test-refresh', { case: 'case-1' }), { value: 2 });
  assert.equal(authenticatedFetch.mock.calls.length, 2);
});

test('does not retain a failed PieceMaker GET request', async () => {
  authenticatedFetch
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'failure' }), { status: 500 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ value: 2 }), { status: 200 }));

  await assert.rejects(pmGetCached('/cache-test-retry'));
  assert.deepEqual(await pmGetCached('/cache-test-retry'), { value: 2 });
  assert.equal(authenticatedFetch.mock.calls.length, 2);
});
