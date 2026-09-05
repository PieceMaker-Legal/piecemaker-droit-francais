import assert from 'node:assert/strict';

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

const { pmGet, pmPost } = vi.hoisted(() => ({
  pmGet: vi.fn(),
  pmPost: vi.fn(),
}));

vi.mock('@/piecemaker/dossier/api', () => ({
  PieceMakerApiError: class extends Error {},
  pmGet,
  pmPost,
}));

import { DossierCasesProvider, useDossierCases } from '@/piecemaker/dossier/DossierContext';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function SelectionProbe() {
  const { loading, selectedCase } = useDossierCases();
  return <span>{loading ? 'loading' : selectedCase?.location ?? 'none'}</span>;
}

test('registers the selected sidebar folder as a legal case', async () => {
  pmGet.mockResolvedValue({ folders: [] });
  pmPost.mockResolvedValue({
    ok: true,
    folder: {
      path: 'folder-selected',
      name: 'Selected',
      location: '/cases/Selected',
      registered: true,
    },
  });

  const screen = render(
    <DossierCasesProvider projectPath="/cases/Selected">
      <SelectionProbe />
    </DossierCasesProvider>,
  );

  await waitFor(() => assert.equal(screen.getByText('/cases/Selected').textContent, '/cases/Selected'));
  assert.deepEqual(pmPost.mock.calls, [['/repository/cases/selected', { folder: '/cases/Selected' }]]);
});

test('uses an exact registered folder without registering it again', async () => {
  pmGet.mockResolvedValue({
    folders: [{
      path: 'folder-selected',
      name: 'Selected',
      location: '/cases/Selected',
      registered: true,
    }],
  });

  const screen = render(
    <DossierCasesProvider projectPath="/cases/Selected">
      <SelectionProbe />
    </DossierCasesProvider>,
  );

  await waitFor(() => assert.equal(screen.getByText('/cases/Selected').textContent, '/cases/Selected'));
  assert.equal(pmPost.mock.calls.length, 0);
});

test('registers a selected nested folder as its own legal case', async () => {
  pmGet.mockResolvedValue({
    folders: [{
      path: 'folder-parent',
      name: 'Parent',
      location: '/cases/Parent',
      registered: true,
    }],
  });
  pmPost.mockResolvedValue({
    ok: true,
    folder: {
      path: 'folder-child',
      name: 'Child',
      location: '/cases/Parent/Child',
      registered: true,
    },
  });

  const screen = render(
    <DossierCasesProvider projectPath="/cases/Parent/Child">
      <SelectionProbe />
    </DossierCasesProvider>,
  );

  await waitFor(() => assert.equal(screen.getByText('/cases/Parent/Child').textContent, '/cases/Parent/Child'));
  assert.deepEqual(pmPost.mock.calls, [['/repository/cases/selected', { folder: '/cases/Parent/Child' }]]);
});
