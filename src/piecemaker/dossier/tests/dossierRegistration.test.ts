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
