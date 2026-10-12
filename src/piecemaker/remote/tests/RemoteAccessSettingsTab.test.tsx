import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { RemoteAccessSettingsTab, type RemoteStatus } from '@/piecemaker/remote/RemoteAccessSettingsTab';

const pmGet = vi.fn();
const pmPost = vi.fn();

vi.mock('@/piecemaker/dossier/api', () => ({ pmGet: (...args: unknown[]) => pmGet(...args), pmPost: (...args: unknown[]) => pmPost(...args) }));
const translate = (key: string) => key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));

const ready: RemoteStatus = {
  tailscale: { installed: true, running: true, httpsEnabled: true, dnsName: 'poste-exemple.tailnet-exemple.ts.net' },
  httpsPort: 443,
  devMode: false,
  keepAwake: false,
  published: false,
  funnel: false,
  conflict: false,
  url: null,
};

beforeEach(() => {
  pmGet.mockReset();
  pmPost.mockReset();
});

it('propose l’installation quand Tailscale est absent', async () => {
  pmGet.mockResolvedValue({ ...ready, tailscale: { installed: false, running: false, httpsEnabled: false, dnsName: null } });
  render(<RemoteAccessSettingsTab />);
  expect(await screen.findByText('remote.missing')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'remote.install' }).getAttribute('href')).toBe('https://pkgs.tailscale.com/stable/Tailscale-latest-macos.pkg');
  expect(screen.queryByRole('button', { name: 'remote.publish' })).toBeNull();
});

it('publie puis affiche le lien à copier', async () => {
  pmGet.mockResolvedValue(ready);
  pmPost.mockResolvedValue({ ...ready, published: true, keepAwake: true, url: 'https://poste-exemple.tailnet-exemple.ts.net' });
  render(<RemoteAccessSettingsTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'remote.publish' }));
  expect(await screen.findByText('https://poste-exemple.tailnet-exemple.ts.net')).toBeTruthy();
  expect(pmPost).toHaveBeenCalledWith('/remote', { enabled: true });
  expect(screen.getByRole('button', { name: 'remote.unpublish' })).toBeTruthy();
});

it('affiche le lien d’autorisation Tailscale quand HTTPS n’est pas encore permis', async () => {
  pmGet.mockResolvedValue({ ...ready, tailscale: { ...ready.tailscale, httpsEnabled: false } });
  pmPost.mockResolvedValue({ ...ready, consentUrl: 'https://login.tailscale.com/f/serve?node=abc' });
  render(<RemoteAccessSettingsTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'remote.publish' }));
  await waitFor(() => expect(screen.getByRole('link', { name: 'remote.consentAction' }).getAttribute('href')).toBe('https://login.tailscale.com/f/serve?node=abc'));
});

it('bloque la publication quand Funnel est actif', async () => {
  pmGet.mockResolvedValue({ ...ready, funnel: true });
  render(<RemoteAccessSettingsTab />);
  expect(await screen.findByText('remote.funnel')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'remote.publish' }) as HTMLButtonElement).disabled).toBe(true);
});
