import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { PseudonymizationSystem } from '@/modules/pseudonymization';

const { api } = vi.hoisted(() => ({
  api: { status: vi.fn(), jobs: vi.fn(), install: vi.fn(), pause: vi.fn() },
}));

vi.mock('@/shared/piecemaker/api', () => ({ pseudonymizationApi: api }));
vi.mock('@/shared/authToken', () => ({ getStoredAuthToken: () => 'jeton-test' }));

const runningGliner = { id: 'job-gliner', component: 'gliner', state: 'running', progress: 'model.safetensors : 312 Mo / 1,1 Go', error: '' };
const pausedGliner = { ...runningGliner, state: 'paused' };

function serverState(glinerInstalled: boolean, jobs: unknown[], busy: boolean, paused: boolean) {
  api.status.mockResolvedValue({ components: { gliner: { name: 'GLiNER2-PII', installed: glinerInstalled }, mineru: { name: 'MinerU · OCR', installed: true } } });
  api.jobs.mockResolvedValue({ jobs, busy, paused });
}

function renderSystem() {
  const slot = document.createElement('span');
  document.body.append(slot);
  render(<PseudonymizationSystem buttonSlots={[slot]} />);
  return slot;
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

it('affiche le bouclier avec un point bleu pendant une installation, puis permet la pause et la reprise', async () => {
  serverState(false, [runningGliner], true, false);
  api.pause.mockResolvedValue({ job: pausedGliner });
  api.install.mockResolvedValue({ job: runningGliner });
  const slot = renderSystem();

  await waitFor(() => expect(slot.querySelector('.pm-pseudo-dot')).not.toBeNull());
  act(() => { window.dispatchEvent(new Event('piecemaker:pseudonymization-open')); });

  serverState(false, [pausedGliner], false, true);
  fireEvent.click(await screen.findByRole('button', { name: 'Mettre en pause' }));
  await waitFor(() => expect(api.pause).toHaveBeenCalledTimes(1));
  expect(await screen.findByText('Préparation en pause')).toBeTruthy();
  await waitFor(() => expect(slot.querySelector('.pm-pseudo-dot')).toBeNull(), { timeout: 4000 });
  expect(slot.querySelector('.pm-pseudo-trigger')).not.toBeNull();
  expect(api.install).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Reprendre' }));
  await waitFor(() => expect(api.install).toHaveBeenCalledWith('gliner'));
});

it('masque le bouclier une fois tout installé', async () => {
  serverState(true, [], false, false);
  const slot = renderSystem();

  await waitFor(() => expect(api.status).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(slot.querySelector('.pm-pseudo-trigger')).toBeNull();
  expect(api.install).not.toHaveBeenCalled();
});
