import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { AnonymizationLauncher } from '@/piecemaker/sidebar-anonymization/AnonymizationLauncher';
import { ANONYMIZATION_COMPLETED_EVENT, clearTrackedAnonymizationJobs, KNOWLEDGE_SCAN_EVENT, trackAnonymizationJob } from '@/piecemaker/dossier/anonymizationJobsCache';

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
  clearTrackedAnonymizationJobs();
  localStorage.clear();
  projectsRequest.mockReset().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(projects), { status: 200 })));
  pmGet.mockReset().mockResolvedValue({ projects: [] });
  pmPost.mockReset().mockImplementation((path: string, body: { projectId?: string }) => {
    const suffix = pmPost.mock.calls.filter(([calledPath]) => calledPath === '/knowledge/scan').length;
    return Promise.resolve({
      job: {
        id: `job-${suffix}`,
        projectId: body.projectId ?? '',
        state: 'running',
        percent: 0,
        error: null,
      },
    });
  });
});

it('never registers a legal case just to display the project list', async () => {
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
  await screen.findByRole('checkbox', { name: 'Sélectionner Dossier A' });
  expect(pmGet).not.toHaveBeenCalled();
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

  await waitFor(() => expect(pmPost).toHaveBeenCalledTimes(2));
  expect(pmPost.mock.calls.filter(([path]) => path === '/knowledge/scan').map(([, body]) => body)).toEqual([
    { projectId: 'one', ocrMissing: 'ask' },
    { projectId: 'two', ocrMissing: 'ask' },
  ]);
  expect(firstProgressSlot.querySelector('[role="progressbar"]')).not.toBeNull();
  expect(secondProgressSlot.querySelector('[role="progressbar"]')).not.toBeNull();
  expect(firstProgressSlot.textContent).toBe('0 %');
  expect(secondProgressSlot.textContent).toBe('0 %');
});

it('marks analyzed projects and selects only the remaining projects', async () => {
  projectsRequest.mockImplementation(() => Promise.resolve(new Response(JSON.stringify([
    { ...projects[0], anonymizationComplete: true },
    projects[1],
  ]), { status: 200 })));
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
  let completed = false;
  const markCompleted = () => { completed = true; };
  window.addEventListener(ANONYMIZATION_COMPLETED_EVENT, markCompleted);

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

  pmGet.mockImplementation((path: string) => (path === '/knowledge/scan/job'
    ? Promise.resolve({ job: { id: 'job-0', projectId: 'one', state: 'done', percent: 100, error: null } })
    : Promise.resolve({ projects: [] })));

  await waitFor(() => expect(progressSlot.querySelector('[role="progressbar"]')).toBeNull(), { timeout: 4000 });
  expect(completed).toBe(true);
  window.removeEventListener(ANONYMIZATION_COMPLETED_EVENT, markCompleted);
  expect(JSON.parse(localStorage.getItem('piecemaker.sidebarAnonymizationJobs') ?? '[]')).toEqual([]);

  pmGet.mockImplementation((path: string) => (path === '/knowledge/scan/job'
    ? Promise.resolve({ job: { id: 'job-1', projectId: 'two', state: 'running', percent: 20, error: null } })
    : Promise.resolve({ projects: [] })));
  fireEvent.click(screen.getByRole('button', { name: 'Mettre en file' }));

  await waitFor(() => expect(progressSlot.querySelector('[role="progressbar"]')).not.toBeNull());
});

it('shows the progress bar for a job started outside the dialog', async () => {
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

  trackAnonymizationJob({
    projectPath: '/cabinet/a',
    projectName: 'Dossier A',
    job: { id: 'job-relaunch', case: 'dossier-a', state: 'running', percent: 30 },
  });

  await waitFor(() => expect(progressSlot.querySelector('[role="progressbar"]')).not.toBeNull());
  expect(progressSlot.textContent).toContain('30 %');
});

it('shows the progress bar for a scan announced by the dossier plugin', async () => {
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

  const broadcast = (percent: number, state: 'running' | 'done') => window.dispatchEvent(new CustomEvent(KNOWLEDGE_SCAN_EVENT, {
    detail: {
      projectPath: '/cabinet/a',
      projectName: 'Dossier A',
      job: { id: 'knowledge-job', projectId: 'dossier-a', state, phase: 'scan', percent, processed: 1, total: 4, error: null },
    },
  }));

  broadcast(40, 'running');
  await waitFor(() => expect(progressSlot.querySelector('[role="progressbar"]')).not.toBeNull());
  expect(progressSlot.textContent).toBe('40 %');
  expect(progressSlot.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('40');

  let completed = false;
  const markCompleted = () => { completed = true; };
  window.addEventListener(ANONYMIZATION_COMPLETED_EVENT, markCompleted);
  broadcast(100, 'done');
  await waitFor(() => expect(progressSlot.querySelector('[role="progressbar"]')).toBeNull());
  expect(completed).toBe(true);
  window.removeEventListener(ANONYMIZATION_COMPLETED_EVENT, markCompleted);
});
