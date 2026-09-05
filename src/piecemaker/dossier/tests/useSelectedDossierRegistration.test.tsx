import assert from 'node:assert/strict';

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

const { ensureDossierRegistration } = vi.hoisted(() => ({
  ensureDossierRegistration: vi.fn().mockResolvedValue({ cases: [], selectedCase: null }),
}));

vi.mock('@/piecemaker/dossier/dossierRegistration', () => ({ ensureDossierRegistration }));

import { useSelectedDossierRegistration } from '@/piecemaker/dossier/useSelectedDossierRegistration';
import type { Project } from '@/shared/types';

const project = {
  projectId: 'project-selected',
  name: 'Selected',
  displayName: 'Selected',
  path: '/encoded/path',
  fullPath: '/cases/Selected',
  sessions: [],
} as Project;

beforeEach(() => {
  ensureDossierRegistration.mockReset();
  ensureDossierRegistration.mockResolvedValue({ cases: [], selectedCase: null });
});

test('registers every project selected in the CloudCLI workspace', async () => {
  const { rerender } = renderHook(
    ({ selectedProject }) => useSelectedDossierRegistration(selectedProject),
    { initialProps: { selectedProject: null as Project | null } },
  );

  assert.equal(ensureDossierRegistration.mock.calls.length, 0);
  rerender({ selectedProject: project });

  await waitFor(() => assert.deepEqual(ensureDossierRegistration.mock.calls, [['/cases/Selected']]));
});
