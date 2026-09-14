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
  projectsRequest.mockReset().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(projects), { status: 200 })));
  pmGet.mockReset().mockResolvedValue({ exists: false, mapping: {} });
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
  await screen.findByRole('checkbox', { name: 'Sélectionner Dossier A' });
  await waitFor(() => expect((screen.getByRole('button', { name: 'Mettre en file' }) as HTMLButtonElement).disabled).toBe(false));
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

it('marks analyzed projects and selects only the remaining projects', async () => {
  pmGet.mockImplementation((_path: string, params: { case: string }) => Promise.resolve(
    params.case === '/cabinet/a'
      ? { exists: true, mapping: { 'Mme Exemple': 'PERSONNE_1' } }
      : { exists: false, mapping: {} },
  ));
  const buttonSlot = document.createElement('span');
  document.body.append(buttonSlot);

  render(
    <AnonymizationLauncher
      buttonSlots={[buttonSlot]}
      progressSlots={new Map()}
      onProjectsChange={() => undefined}
    />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Anonymiser les dossiers' }));
  await screen.findByLabelText('Anonymisation effectuée');
  fireEvent.click(screen.getByRole('button', { name: 'Non analysés' }));

  expect((screen.getByRole('checkbox', { name: 'Sélectionner Dossier A' }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole('checkbox', { name: 'Sélectionner Dossier B' }) as HTMLInputElement).checked).toBe(true);
});

it('removes the progress bar once the job is finished and shows it again on relaunch', async () => {
  const buttonSlot = document.createElement('span');
  const progressSlot = document.createElement('div');
  document.body.append(buttonSlot, progressSlot);

  render(
    <AnonymizationLauncher
      buttonSlots={[buttonSlot]}
      progressSlots={new Map([['/cabinet/a', progressSlot]])}
      onProjectsChange={() => undefined}
    />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Anonymiser les dossiers' }));
  await screen.findByRole('checkbox', { name: 'Sélectionner Dossier A' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Sélectionner Dossier B' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Mettre en file' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Mettre en file' }));

  await waitFor(() => expect(progressSlot.querySelector('[role="progressbar"]')).not.toBeNull());

  pmGet.mockImplementation((path: string) => (path === '/originals/job'
    ? Promise.resolve({ job: { id: 'job-0', state: 'done', percent: 100 } })
    : Promise.resolve({ exists: false, mapping: {} })));

  await waitFor(() => expect(progressSlot.querySelector('[role="progressbar"]')).toBeNull(), { timeout: 4000 });
  expect(JSON.parse(localStorage.getItem('piecemaker.sidebarAnonymizationJobs') ?? '[]')).toEqual([]);

  pmGet.mockImplementation((path: string) => (path === '/originals/job'
    ? Promise.resolve({ job: { id: 'job-1', state: 'running', percent: 20, phase: 'scan' } })
    : Promise.resolve({ exists: false, mapping: {} })));
  fireEvent.click(screen.getByRole('button', { name: 'Mettre en file' }));

  await waitFor(() => expect(progressSlot.querySelector('[role="progressbar"]')).not.toBeNull());
});
