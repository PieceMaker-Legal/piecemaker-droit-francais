import assert from 'node:assert/strict';

import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, test, vi } from 'vitest';

const { ensureDossierRegistration } = vi.hoisted(() => ({
  ensureDossierRegistration: vi.fn().mockResolvedValue({ cases: [], selectedCase: null }),
}));

const { pmGetCached } = vi.hoisted(() => ({
  pmGetCached: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/piecemaker/dossier/dossierRegistration', () => ({ ensureDossierRegistration }));
vi.mock('@/piecemaker/dossier/api', () => ({ pmGetCached }));

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
  pmGetCached.mockClear();
});

test('registers every project selected in the CloudCLI workspace', async () => {
  const { rerender } = renderHook(
    ({ selectedProject }) => useSelectedDossierRegistration(selectedProject),
    { initialProps: { selectedProject: null as Project | null }, wrapper: MemoryRouter },
  );

  assert.equal(ensureDossierRegistration.mock.calls.length, 0);
  rerender({ selectedProject: project });

  await waitFor(() => assert.deepEqual(ensureDossierRegistration.mock.calls, [['/cases/Selected']]));
});

test('preloads the dossier views for the selected legal case', async () => {
  ensureDossierRegistration.mockResolvedValue({
    cases: [],
    selectedCase: { path: 'selected-case', name: 'Selected', location: '/cases/Selected', registered: true },
  });

  renderHook(
    () => useSelectedDossierRegistration(project),
    { wrapper: MemoryRouter },
  );

  await waitFor(() => assert.equal(pmGetCached.mock.calls.length, 4));
  assert.deepEqual(pmGetCached.mock.calls, [
    ['/repository/case', { case: 'selected-case' }],
    ['/mapping', { case: 'selected-case' }],
    ['/repository/chronology', { case: 'selected-case' }],
    ['/configuration'],
  ]);
});
