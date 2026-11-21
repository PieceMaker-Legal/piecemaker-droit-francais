import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { ProviderLimitsButton } from '@/modules/piecemaker-provider-limits';
import { pmGet } from '@/piecemaker/dossier/api';

vi.mock('@/piecemaker/dossier/api', () => ({
  pmGet: vi.fn(async () => ({ data: { providers: [
    { provider: 'claude', connected: true, windows: [{ id: 'five_hour', usedPercent: 42.4, resetsAt: null }, { id: 'seven_day', usedPercent: 91, resetsAt: null }] },
    { provider: 'codex', connected: false, windows: [] },
    { provider: 'mistral', connected: true, windows: [], message: 'Mistral ne publie pas de consommation sur 5 h ni à la semaine.' },
  ] } })),
}));

it('ouvre la vue rapide des providers connectés et actualise à la demande', async () => {
  render(<ProviderLimitsButton />);
  fireEvent.click(screen.getByRole('button', { name: 'Consommation des providers' }));
  expect(await screen.findByRole('progressbar', { name: '5 h : 42 %' })).toBeTruthy();
  expect(screen.getByRole('progressbar', { name: 'Semaine : 91 %' })).toBeTruthy();
  expect(screen.getByText(/Mistral ne publie pas/)).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Codex' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Actualiser' }));
  expect(vi.mocked(pmGet)).toHaveBeenLastCalledWith('/provider-limits', { refresh: 1 });
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});
