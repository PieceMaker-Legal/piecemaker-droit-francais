import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { CaseConversionCard } from '@/modules/piecemaker-case-conversion';
import { pmGet } from '@/piecemaker/dossier/api';
import { clearTrackedAnonymizationJobs } from '@/piecemaker/dossier/anonymizationJobsCache';
import type { Project } from '@/shared/types';

const server = vi.hoisted(() => ({
  status: null as null | { aConvertir: boolean; bilan: string; revoirMapping: boolean },
  jobs: new Map<string, { id: string; projectId: string; state: string; percent: number; error: string | null }>(),
  running: null as null | { id: string; projectId: string; state: string; percent: number; error: string | null },
  posts: [] as unknown[],
}));

vi.mock('@/piecemaker/dossier/api', () => ({
  pmGet: vi.fn(async (path: string, params: Record<string, string>) => {
    if (path === '/etapes/conversion') return server.status;
    if (path === '/knowledge/scan/job') return { job: params.id ? server.jobs.get(params.id) ?? null : server.running };
    throw new Error(path);
  }),
  pmPost: vi.fn(async (path: string, body: unknown) => {
    server.posts.push({ path, body });
    const job = { id: 'job-1', projectId: 'p1', state: 'running', percent: 0, error: null };
    server.jobs.set(job.id, job);
    return { job };
  }),
}));

const project = { projectId: 'p1', fullPath: '/dossiers/dupont', displayName: 'Dupont c/ Société Exemple SAS' } as Project;

beforeEach(() => {
  server.status = null;
  server.jobs.clear();
  server.running = null;
  server.posts = [];
  vi.mocked(pmGet).mockClear();
});

afterEach(() => clearTrackedAnonymizationJobs());

it('offers the conversion of an unconverted case and follows its progress until the mapping review', async () => {
  server.status = { aConvertir: true, bilan: '2 pièces à convertir', revoirMapping: false };
  const opened: unknown[] = [];
  const record = (event: Event) => opened.push((event as CustomEvent).detail);
  window.addEventListener('piecemaker:open-panel', record);
  try {
    render(<CaseConversionCard project={project} />);
    expect(await screen.findByText(/2 pièces à convertir/)).toBeTruthy();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole('button', { name: 'Convertir le dossier' }));
    expect(await screen.findByRole('progressbar')).toBeTruthy();
    expect(server.posts).toEqual([{ path: '/knowledge/scan', body: { projectId: 'p1', ocrMissing: 'ask' } }]);

    server.jobs.set('job-1', { id: 'job-1', projectId: 'p1', state: 'running', percent: 42, error: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('42');

    server.jobs.set('job-1', { id: 'job-1', projectId: 'p1', state: 'done', percent: 100, error: null });
    server.status = { aConvertir: false, bilan: 'toutes converties', revoirMapping: true };
    await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
    vi.useRealTimers();
    expect(await screen.findByText('Conversion terminée.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Relire le mapping' }));
    expect(opened).toEqual([{ tab: 'plugin:piecemaker-dossier' }]);
    expect((window as Window & { __piecemakerMappingShow?: string }).__piecemakerMappingShow).toBe('/dossiers/dupont');
  } finally {
    vi.useRealTimers();
    window.removeEventListener('piecemaker:open-panel', record);
    delete (window as Window & { __piecemakerMappingShow?: string }).__piecemakerMappingShow;
  }
});

it('shows the progress of a conversion launched elsewhere, such as by the assistant', async () => {
  server.status = { aConvertir: true, bilan: '1 pièce à convertir', revoirMapping: false };
  server.running = { id: 'job-9', projectId: 'p1', state: 'running', percent: 10, error: null };
  server.jobs.set('job-9', server.running);
  render(<CaseConversionCard project={project} />);
  expect(await screen.findByRole('progressbar')).toBeTruthy();
});

it('stays hidden once the mapping is validated, and for a case marked non-legal', async () => {
  server.status = { aConvertir: false, bilan: 'toutes converties', revoirMapping: false };
  const { container, rerender } = render(<CaseConversionCard project={project} />);
  await waitFor(() => expect(vi.mocked(pmGet)).toHaveBeenCalledWith('/etapes/conversion', { projectPath: '/dossiers/dupont' }));
  await act(async () => { await Promise.resolve(); });
  expect(container.innerHTML).toBe('');

  server.status = null;
  rerender(<CaseConversionCard project={{ ...project, projectId: 'p2', fullPath: '/dossiers/autre' } as Project} />);
  await waitFor(() => expect(vi.mocked(pmGet)).toHaveBeenCalledWith('/etapes/conversion', { projectPath: '/dossiers/autre' }));
  await act(async () => { await Promise.resolve(); });
  expect(container.innerHTML).toBe('');
});

it('asks to review a converted case whose mapping is not validated yet, and hides after validation', async () => {
  server.status = { aConvertir: false, bilan: 'toutes converties', revoirMapping: true };
  render(<CaseConversionCard project={project} />);
  expect(await screen.findByText('Mapping à valider.')).toBeTruthy();
  server.status = { ...server.status, revoirMapping: false };
  act(() => {
    window.dispatchEvent(new CustomEvent('piecemaker:anonymization-state', { detail: { tab: 'plugin:piecemaker-dossier', project: '/dossiers/dupont', anonymized: true, pending: false } }));
  });
  await waitFor(() => expect(screen.queryByText('Mapping à valider.')).toBeNull());
});

it('opens a cached card while verification is pending and respects its dismissal', async () => {
  const cached = { aConvertir: true, bilan: '2 pièces à convertir', revoirMapping: false };
  let finish!: (value: unknown) => void;
  vi.mocked(pmGet).mockResolvedValueOnce(cached).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { container } = render(<CaseConversionCard project={project} />);
  expect(await screen.findByText(cached.bilan)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Fermer la carte de conversion' }));
  await act(async () => { finish({ aConvertir: false, revoirMapping: true }); });
  expect(container.innerHTML).toBe('');
});

it('checks a case in the background when the cache is empty', async () => {
  vi.mocked(pmGet).mockResolvedValueOnce(null);
  server.status = { aConvertir: true, bilan: '1 pièce à convertir', revoirMapping: false };
  const { container } = render(<CaseConversionCard project={project} />);
  expect(container.innerHTML).toBe('');
  expect(await screen.findByText(server.status.bilan)).toBeTruthy();
  expect(pmGet).toHaveBeenCalledWith('/etapes/conversion', { projectPath: project.fullPath, frais: '1' });
});
