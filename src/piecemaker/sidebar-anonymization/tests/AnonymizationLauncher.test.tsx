import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { AnonymizationLauncher } from '@/piecemaker/sidebar-anonymization/AnonymizationLauncher';

const { projectsRequest, pmGet, pmPost } = vi.hoisted(() => ({
  projectsRequest: vi.fn(),
  pmGet: vi.fn(),
  pmPost: vi.fn(),
}));

vi.mock('@/shared/api', () => ({ api: { projects: projectsRequest } }));
vi.mock('@/piecemaker/dossier/api', () => ({
  pmGet,
  pmPost,
  PieceMakerApiError: class extends Error {},
}));

const projects = [
  { projectId: 'one', displayName: 'Dossier A', fullPath: '/cabinet/a' },
  { projectId: 'two', displayName: 'Dossier B', fullPath: '/cabinet/b' },
];

beforeEach(() => {
  localStorage.clear();
  projectsRequest.mockReset().mockResolvedValue(new Response(JSON.stringify(projects), { status: 200 }));
  pmGet.mockReset();
  pmPost.mockReset().mockImplementation((path: string, body: { folder?: string }) => {
    if (path === '/repository/cases/selected') return Promise.resolve({ folder: { path: body.folder } });
    const suffix = pmPost.mock.calls.filter(([calledPath]) => calledPath === '/originals/pipeline').length;
    return Promise.resolve({
      job: {
        id: `job-${suffix}`,
        case: body.folder ?? '',
        action: 'anonymize',
        state: 'queued',
        percent: 0,
        queuePosition: suffix,
      },
    });
  });
});

it('queues every project and renders each server job inside its project row', async () => {
  const buttonSlot = document.createElement('span');
  const firstProgressSlot = document.createElement('div');
  const secondProgressSlot = document.createElement('div');
  document.body.append(buttonSlot, firstProgressSlot, secondProgressSlot);

  render(
    <AnonymizationLauncher
      buttonSlots={[buttonSlot]}
      progressSlots={new Map([
        ['/cabinet/a', firstProgressSlot],
        ['/cabinet/b', secondProgressSlot],
      ])}
      onProjectsChange={() => undefined}
    />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Anonymiser les dossiers' }));
  await screen.findByRole('option', { name: 'Tous les dossiers (2)' });
  fireEvent.click(screen.getByRole('button', { name: 'Mettre en file' }));

  await waitFor(() => expect(pmPost).toHaveBeenCalledTimes(4));
  expect(pmPost.mock.calls.filter(([path]) => path === '/originals/pipeline').map(([, body]) => body)).toEqual([
    { case: '/cabinet/a', action: 'anonymize', files: [], force: false, engine: 'markitdown' },
    { case: '/cabinet/b', action: 'anonymize', files: [], force: false, engine: 'markitdown' },
  ]);
  expect(firstProgressSlot.querySelector('[role="progressbar"]')).not.toBeNull();
  expect(secondProgressSlot.querySelector('[role="progressbar"]')).not.toBeNull();
  expect(firstProgressSlot.textContent).toContain('En attente');
  expect(secondProgressSlot.textContent).toContain('En attente');
});
