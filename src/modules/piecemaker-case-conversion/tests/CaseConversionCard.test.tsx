import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { CaseConversionCard } from '@/modules/piecemaker-case-conversion';
import { pmGet } from '@/piecemaker/dossier/api';
import { clearTrackedAnonymizationJobs } from '@/piecemaker/dossier/anonymizationJobsCache';
import type { Project } from '@/shared/types';

const server = vi.hoisted(() => ({
  pieces: [] as { status: string }[],
  etapes: {} as { mappingValide?: string; nonJuridique?: boolean },
  jobs: new Map<string, { id: string; projectId: string; state: string; percent: number; error: string | null }>(),
  running: null as null | { id: string; projectId: string; state: string; percent: number; error: string | null },
  posts: [] as unknown[],
}));

vi.mock('@/piecemaker/dossier/api', () => ({
  pmGet: vi.fn(async (path: string, params: Record<string, string>) => {
    if (path === '/knowledge/pieces') return { pieces: server.pieces };
    if (path === '/etapes/dossier') return server.etapes;
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
  server.pieces = [];
  server.etapes = {};
  server.jobs.clear();
  server.running = null;
  server.posts = [];
  vi.mocked(pmGet).mockClear();
});

afterEach(() => clearTrackedAnonymizationJobs());

it('offers the conversion of an unconverted case and follows its progress until the mapping review', async () => {
  server.pieces = [{ status: 'not-converted' }, { status: 'awaiting-scan' }, { status: 'ready' }];
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
    server.pieces = [{ status: 'ready' }, { status: 'ready' }, { status: 'ready' }];
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
  server.pieces = [{ status: 'not-converted' }];
  server.running = { id: 'job-9', projectId: 'p1', state: 'running', percent: 10, error: null };
  server.jobs.set('job-9', server.running);
  render(<CaseConversionCard project={project} />);
  expect(await screen.findByRole('progressbar')).toBeTruthy();
});

it('stays hidden once the mapping is validated, and for a case marked non-legal', async () => {
  server.pieces = [{ status: 'ready' }];
  server.etapes = { mappingValide: '2026-11-18T10:00:00.000Z' };
  const { container, rerender } = render(<CaseConversionCard project={project} />);
  await waitFor(() => expect(vi.mocked(pmGet)).toHaveBeenCalledWith('/etapes/dossier', { projectPath: '/dossiers/dupont' }));
  await act(async () => { await Promise.resolve(); });
  expect(container.innerHTML).toBe('');

  server.pieces = [{ status: 'not-converted' }];
  server.etapes = { nonJuridique: true };
  rerender(<CaseConversionCard project={{ ...project, projectId: 'p2', fullPath: '/dossiers/autre' } as Project} />);
  await waitFor(() => expect(vi.mocked(pmGet)).toHaveBeenCalledWith('/etapes/dossier', { projectPath: '/dossiers/autre' }));
  await act(async () => { await Promise.resolve(); });
  expect(container.innerHTML).toBe('');
});

it('asks to review a converted case whose mapping is not validated yet, and hides after validation', async () => {
  server.pieces = [{ status: 'ready' }];
  render(<CaseConversionCard project={project} />);
  expect(await screen.findByText('Mapping à valider.')).toBeTruthy();
  server.etapes = { mappingValide: '2026-11-18T10:00:00.000Z' };
  act(() => {
    window.dispatchEvent(new CustomEvent('piecemaker:anonymization-state', { detail: { tab: 'plugin:piecemaker-dossier', project: '/dossiers/dupont', anonymized: true, pending: false } }));
  });
  await waitFor(() => expect(screen.queryByText('Mapping à valider.')).toBeNull());
});
