import assert from 'node:assert/strict';

import { beforeEach, test, vi } from 'vitest';

const { pmGet, pmPost } = vi.hoisted(() => ({
  pmGet: vi.fn(),
  pmPost: vi.fn(),
}));

vi.mock('@/piecemaker/dossier/api', () => ({ pmGet, pmPost }));

import { ensureDossierRegistration } from '@/piecemaker/dossier/dossierRegistration';

beforeEach(() => {
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

test('shares one repository read between dossiers registered together', async () => {
  pmGet.mockResolvedValue({
    folders: [
      { path: 'case-a', name: 'A', location: '/cases/A', registered: true },
      { path: 'case-b', name: 'B', location: '/cases/B', registered: true },
    ],
  });

  const [first, second] = await Promise.all([ensureDossierRegistration('/cases/A'), ensureDossierRegistration('/cases/B')]);

  assert.equal(first.selectedCase?.path, 'case-a');
  assert.equal(second.selectedCase?.path, 'case-b');
  assert.equal(pmGet.mock.calls.length, 1);
});
