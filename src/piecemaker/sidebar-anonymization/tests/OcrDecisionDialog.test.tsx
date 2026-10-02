import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { OcrDecisionDialog } from '@/piecemaker/sidebar-anonymization/OcrDecisionDialog';
import {
  clearTrackedAnonymizationJobs,
  getTrackedAnonymizationJobs,
  OCR_DECISION_EVENT,
  trackAnonymizationJob,
} from '@/piecemaker/dossier/anonymizationJobsCache';

const { pmGet, pmPost } = vi.hoisted(() => ({
  pmGet: vi.fn(),
  pmPost: vi.fn(),
}));

vi.mock('@/piecemaker/dossier/api', () => ({
  pmGet,
  pmPost,
  PieceMakerApiError: class extends Error {},
}));

const request = {
  projectId: 'dossier-a',
  projectPath: '/cabinet/a',
  projectName: 'Dossier A',
  files: ['scans/bail.pdf', 'photos/recu.png'],
};

function scanResponse(body: { projectId: string }) {
  return Promise.resolve({ job: { id: `job-${body.projectId}`, projectId: body.projectId, state: 'running', percent: 0, error: null } });
}

function scanBodies() {
  return pmPost.mock.calls.filter(([path]) => path === '/knowledge/scan').map(([, body]) => body);
}

beforeEach(() => {
  clearTrackedAnonymizationJobs();
  localStorage.clear();
  pmGet.mockReset();
  pmPost.mockReset().mockImplementation((path: string, body: { projectId: string }) => (path === '/knowledge/scan'
    ? scanResponse(body)
    : Promise.resolve({ job: { id: 'install-1', component: 'mineru', state: 'done', progress: 'Installation terminée.', error: '' } })));
});

function announce(detail = request) {
  window.dispatchEvent(new CustomEvent(OCR_DECISION_EVENT, { detail }));
}

it('explique les deux choix et relance sans OCR quand l’installation est refusée', async () => {
  render(<OcrDecisionDialog />);
  announce();

  expect(await screen.findByText('scans/bail.pdf')).toBeTruthy();
  expect(screen.getByText('photos/recu.png')).toBeTruthy();
  expect(screen.getByText(/2 pièces de « Dossier A » sont des scans/)).toBeTruthy();
  expect(screen.getByText(/l’IA ne pourra pas lire ces\s+pièces/)).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Continuer sans OCR' }));

  await waitFor(() => expect(scanBodies()).toEqual([{ projectId: 'dossier-a', ocrMissing: 'continue' }]));
  expect(pmPost.mock.calls.some(([path]) => path === '/configuration/install')).toBe(false);
  await waitFor(() => expect(screen.queryByText('scans/bail.pdf')).toBeNull());
  expect(getTrackedAnonymizationJobs().map((entry) => entry.projectPath)).toEqual(['/cabinet/a']);
});

it('installe MinerU puis relance l’anonymisation avec OCR', async () => {
  pmPost.mockImplementation((path: string, body: { projectId: string }) => (path === '/knowledge/scan'
    ? scanResponse(body)
    : Promise.resolve({ job: { id: 'install-1', component: 'mineru', state: 'running', progress: 'Collecting mineru', error: '' } })));
  pmGet.mockResolvedValue({ job: { id: 'install-1', component: 'mineru', state: 'done', progress: 'Installation terminée.', error: '' } });
  render(<OcrDecisionDialog />);
  announce();

  fireEvent.click(await screen.findByRole('button', { name: 'Installer MinerU' }));

  expect(await screen.findByText('Collecting mineru')).toBeTruthy();
  expect(pmPost).toHaveBeenCalledWith('/configuration/install', { component: 'mineru' });
  await waitFor(() => expect(scanBodies()).toEqual([{ projectId: 'dossier-a', ocrMissing: 'ask' }]), { timeout: 4000 });
  expect(pmGet).toHaveBeenCalledWith('/configuration/install', { id: 'install-1' });
});

it('laisse le choix de continuer sans OCR quand l’installation échoue', async () => {
  pmPost.mockImplementation((path: string, body: { projectId: string }) => (path === '/knowledge/scan'
    ? scanResponse(body)
    : Promise.resolve({ job: { id: 'install-1', component: 'mineru', state: 'failed', progress: '', error: 'pas de réseau' } })));
  render(<OcrDecisionDialog />);
  announce();

  fireEvent.click(await screen.findByRole('button', { name: 'Installer MinerU' }));

  expect(await screen.findByText('L’installation de MinerU a échoué : pas de réseau')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Réessayer l’installation' })).toBeTruthy();
  expect(scanBodies()).toEqual([]);

  fireEvent.click(screen.getByRole('button', { name: 'Continuer sans OCR' }));
  await waitFor(() => expect(scanBodies()).toEqual([{ projectId: 'dossier-a', ocrMissing: 'continue' }]));
});

it('s’ouvre quand un travail suivi s’arrête faute d’OCR', async () => {
  pmGet.mockResolvedValue({
    job: { id: 'job-1', projectId: 'dossier-a', state: 'ocr-required', percent: 0, error: null, ocrRequired: { files: ['scans/bail.pdf'] } },
  });
  render(<OcrDecisionDialog />);
  trackAnonymizationJob({
    projectPath: '/cabinet/a',
    projectName: 'Dossier A',
    job: { id: 'job-1', case: 'dossier-a', state: 'running', percent: 0 },
  });

  expect(await screen.findByText('scans/bail.pdf', undefined, { timeout: 4000 })).toBeTruthy();
  expect(screen.getByText(/1 pièce de « Dossier A » est un scan/)).toBeTruthy();
  await waitFor(() => expect(getTrackedAnonymizationJobs()).toEqual([]));
});
