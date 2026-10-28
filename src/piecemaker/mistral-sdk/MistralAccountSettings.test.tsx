import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { MistralAccountSettings } from '@/piecemaker/mistral-sdk/MistralAccountSettings';

const { api } = vi.hoisted(() => ({ api: { status: vi.fn(), login: vi.fn(), logout: vi.fn(), check: vi.fn() } }));
vi.mock('@/shared/api', () => ({ mistralSdkApi: api }));
vi.mock('@/shared/ui', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
  LLMProviderLogo: () => <span />,
}));

const disconnected = { authenticated: false, loginState: 'idle', error: null };
const connected = { authenticated: true, loginState: 'connected', error: null };

beforeEach(() => {
  vi.clearAllMocks();
  api.status.mockResolvedValue(disconnected);
  api.login.mockResolvedValue({ url: 'https://console.mistral.ai/fictitious-login' });
  api.logout.mockResolvedValue(disconnected);
  api.check.mockResolvedValue({ ok: true, response: 'Connexion Mistral réussie.' });
});

test('settings opens browser sign-in and supports checking and disconnecting the account', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  api.status.mockResolvedValueOnce(disconnected).mockResolvedValue(connected);
  render(<MistralAccountSettings />);
  await screen.findByText('Connectez votre compte pour utiliser Mistral.');
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter avec Mistral' }));
  await screen.findByText('Votre compte Mistral est connecté.');
  expect(open).toHaveBeenCalledExactlyOnceWith('https://console.mistral.ai/fictitious-login', '_blank', 'noopener,noreferrer');
  fireEvent.click(screen.getByRole('button', { name: 'Vérifier la connexion' }));
  await screen.findByText('Connexion Mistral réussie.');
  fireEvent.click(screen.getByRole('button', { name: 'Déconnecter' }));
  await screen.findByText('Connectez votre compte pour utiliser Mistral.');
  expect(api.logout).toHaveBeenCalledOnce();
});

test('a failed browser login stays disconnected and reports the error in settings', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  api.login.mockRejectedValue(new Error('Connexion indisponible'));
  render(<MistralAccountSettings />);
  await screen.findByText('Connectez votre compte pour utiliser Mistral.');
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter avec Mistral' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Connexion indisponible'));
  expect(open).not.toHaveBeenCalled();
  expect(screen.queryByText('Connecté')).toBeNull();
});

test('sign-in waits for the HTTPS URL and keeps a manual link when no popup is returned', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  let completeLogin!: (value: { url: string }) => void;
  api.login.mockReturnValue(new Promise(resolve => { completeLogin = resolve; }));
  render(<MistralAccountSettings />);
  await screen.findByText('Connectez votre compte pour utiliser Mistral.');
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter avec Mistral' }));
  expect(open).not.toHaveBeenCalled();
  api.status.mockResolvedValue({ ...disconnected, loginState: 'pending' });
  completeLogin({ url: 'https://console.mistral.ai/fictitious-login' });
  const link = await screen.findByRole('link', { name: 'Ouvrir la page de connexion Mistral' });
  expect(link.getAttribute('href')).toBe('https://console.mistral.ai/fictitious-login');
  expect(link.getAttribute('target')).toBe('_blank');
  expect(open).toHaveBeenCalledExactlyOnceWith(link.getAttribute('href'), '_blank', 'noopener,noreferrer');
});
