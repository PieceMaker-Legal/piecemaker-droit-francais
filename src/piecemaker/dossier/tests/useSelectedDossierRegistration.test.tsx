import assert from 'node:assert/strict';

import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, test, vi } from 'vitest';

const { ensureDossierRegistration } = vi.hoisted(() => ({
  ensureDossierRegistration: vi.fn().mockResolvedValue({ cases: [], selectedCase: null }),
}));

vi.mock('@/piecemaker/dossier/dossierRegistration', () => ({ ensureDossierRegistration }));
const { publishWorkflowSessionBridge } = vi.hoisted(() => ({ publishWorkflowSessionBridge: vi.fn() }));
vi.mock('@/piecemaker/mike/sessionBridge', () => ({ publishWorkflowSessionBridge }));

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
    { initialProps: { selectedProject: null as Project | null }, wrapper: MemoryRouter },
  );

  assert.equal(ensureDossierRegistration.mock.calls.length, 0);
  rerender({ selectedProject: project });

  await waitFor(() => assert.deepEqual(ensureDossierRegistration.mock.calls, [['/cases/Selected']]));
});

test('publishes the selected project and current path to the workflow session bridge', async () => {
  renderHook(
    ({ selectedProject }) => useSelectedDossierRegistration(selectedProject),
    { initialProps: { selectedProject: project }, wrapper: MemoryRouter },
  );

  await waitFor(() => {
    const payload = publishWorkflowSessionBridge.mock.calls.at(-1)?.[0];
    assert.equal(payload?.projectPath, '/cases/Selected');
    assert.equal(payload?.pathname, '/');
    assert.equal(typeof payload?.navigate, 'function');
  });
});
