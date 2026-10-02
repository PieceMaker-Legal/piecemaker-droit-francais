import assert from 'node:assert/strict';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

const { pmGet, pmPut, ensureDossierRegistration } = vi.hoisted(() => ({
  pmGet: vi.fn(),
  pmPut: vi.fn(),
  ensureDossierRegistration: vi.fn(),
}));

vi.mock('@/piecemaker/dossier/api', () => ({
  pmGet,
  pmPut,
  PieceMakerApiError: class PieceMakerApiError extends Error {},
}));
vi.mock('@/piecemaker/dossier/dossierRegistration', () => ({ ensureDossierRegistration }));

import { CaseProtectionShield } from '@/piecemaker/dossier/CaseProtectionShield';

const stateOf = (active: boolean) => ({ case: 'case-1', active, savedAt: null, savedCount: 0, unprotectedCount: 0 });

beforeEach(() => {
  ensureDossierRegistration.mockReset().mockResolvedValue({ cases: [], selectedCase: { path: 'case-1' } });
  pmGet.mockReset().mockResolvedValue(stateOf(false));
  pmPut.mockReset().mockImplementation(async (_path: string, body: { active: boolean }) => ({ ok: true, ...stateOf(body.active) }));
});

test('bouclier vert, levée en bouclier rouge barré puis rétablissement avec confirmation', async () => {
  const rowClick = vi.fn();
  render(
    <div onClick={rowClick}>
      <CaseProtectionShield projectPath="/dossiers/alpha" anonymized anonymizedLabel="Anonymisation effectuée" />
    </div>,
  );
  const shield = await screen.findByRole('switch');
  await waitFor(() => assert.deepEqual(pmGet.mock.calls[0], ['/protection/bypass', { case: 'case-1' }]));
  assert.equal(ensureDossierRegistration.mock.calls[0][0], '/dossiers/alpha');
  assert.equal(shield.getAttribute('aria-checked'), 'true');
  assert.ok(shield.querySelector('.lucide-shield-check'));

  fireEvent.click(shield);
  await screen.findByText('Lever la protection du dossier ?');
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  await waitFor(() => assert.equal(screen.queryByText('Lever la protection du dossier ?'), null));
  assert.equal(pmPut.mock.calls.length, 0);

  fireEvent.click(shield);
  fireEvent.click(await screen.findByRole('button', { name: 'Lever la protection' }));
  await waitFor(() => assert.equal(screen.getByRole('switch').getAttribute('aria-checked'), 'false'));
  assert.deepEqual(pmPut.mock.calls[0], ['/protection/bypass', { case: 'case-1', active: true }]);
  assert.ok(screen.getByRole('switch').querySelector('.lucide-shield-off'));

  fireEvent.click(screen.getByRole('switch'));
  fireEvent.click(await screen.findByRole('button', { name: 'Rétablir la protection' }));
  await waitFor(() => assert.equal(screen.getByRole('switch').getAttribute('aria-checked'), 'true'));
  assert.deepEqual(pmPut.mock.calls[1], ['/protection/bypass', { case: 'case-1', active: false }]);
  assert.equal(rowClick.mock.calls.length, 0);
});

test('rien sans anonymisation tant que la protection est active, bouclier barré si elle est levée', async () => {
  const { unmount } = render(<CaseProtectionShield projectPath="/dossiers/beta" anonymized={false} anonymizedLabel="Anonymisation effectuée" />);
  await waitFor(() => assert.equal(pmGet.mock.calls.length, 1));
  assert.equal(screen.queryByRole('switch'), null);
  unmount();

  pmGet.mockResolvedValue(stateOf(true));
  render(<CaseProtectionShield projectPath="/dossiers/beta" anonymized={false} anonymizedLabel="Anonymisation effectuée" />);
  const shield = await screen.findByRole('switch');
  assert.equal(shield.getAttribute('aria-checked'), 'false');
});

test('une erreur serveur reste affichée dans la confirmation', async () => {
  pmPut.mockRejectedValueOnce(new Error('dossier introuvable'));
  render(<CaseProtectionShield projectPath="/dossiers/alpha" anonymized anonymizedLabel="Anonymisation effectuée" />);
  const shield = await screen.findByRole('switch');
  await waitFor(() => assert.equal(pmGet.mock.calls.length, 1));
  fireEvent.click(shield);
  fireEvent.click(await screen.findByRole('button', { name: 'Lever la protection' }));
  await screen.findByText('Error: dossier introuvable');
  assert.ok(screen.getByText('Lever la protection du dossier ?'));
});
