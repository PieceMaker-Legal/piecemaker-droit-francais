import assert from 'node:assert/strict';

import { beforeEach, test, vi } from 'vitest';

const { invalidatePmGet, pmGet, pmPost } = vi.hoisted(() => ({
  invalidatePmGet: vi.fn(),
  pmGet: vi.fn(),
  pmPost: vi.fn(),
}));

vi.mock('@/piecemaker/dossier/api', () => ({ invalidatePmGet, pmGet, pmPost }));

import { ensureDossierRegistration, refreshDossierRegistration } from '@/piecemaker/dossier/dossierRegistration';

beforeEach(() => {
  invalidatePmGet.mockClear();
  pmGet.mockReset();
  pmPost.mockReset();
});

test('reuses a completed dossier registration', async () => {
  pmGet.mockResolvedValue({
    folders: [{ path: 'cached-case', name: 'Cached', location: '/cases/Cached', registered: true }],
  });

  const first = ensureDossierRegistration('/cases/Cached');
  const second = ensureDossierRegistration('/cases/Cached');

  assert.equal(first, second);
  assert.equal((await first).selectedCase?.path, 'cached-case');
  assert.equal((await ensureDossierRegistration('/cases/Cached')).selectedCase?.path, 'cached-case');
  assert.equal(pmGet.mock.calls.length, 1);
});

test('reloads dossier registration after an explicit refresh', async () => {
  pmGet
    .mockResolvedValueOnce({ folders: [{ path: 'case-before', name: 'Before', location: '/cases/Refresh', registered: true }] })
    .mockResolvedValueOnce({ folders: [{ path: 'case-after', name: 'After', location: '/cases/Refresh', registered: true }] });

  assert.equal((await ensureDossierRegistration('/cases/Refresh')).selectedCase?.path, 'case-before');
  assert.equal((await refreshDossierRegistration('/cases/Refresh')).selectedCase?.path, 'case-after');
  assert.equal(pmGet.mock.calls.length, 2);
  assert.deepEqual(invalidatePmGet.mock.calls, [
    ['/repository/case', { case: 'case-after' }],
    ['/mapping', { case: 'case-after' }],
    ['/repository/chronology', { case: 'case-after' }],
  ]);
});
