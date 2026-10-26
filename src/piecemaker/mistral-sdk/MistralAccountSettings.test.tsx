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
  const popup = { location: { href: '' }, opener: window, close: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
  api.status.mockResolvedValueOnce(disconnected).mockResolvedValue(connected);
  render(<MistralAccountSettings />);
  await screen.findByText('Connectez votre compte pour utiliser Mistral.');
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter avec Mistral' }));
  await screen.findByText('Votre compte Mistral est connecté.');
  expect(popup.location.href).toBe('https://console.mistral.ai/fictitious-login');
  expect(popup.opener).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Vérifier la connexion' }));
  await screen.findByText('Connexion Mistral réussie.');
  fireEvent.click(screen.getByRole('button', { name: 'Déconnecter' }));
  await screen.findByText('Connectez votre compte pour utiliser Mistral.');
  expect(api.logout).toHaveBeenCalledOnce();
});

test('a failed browser login stays disconnected and reports the error in settings', async () => {
  const popup = { close: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
  api.login.mockRejectedValue(new Error('Connexion indisponible'));
  render(<MistralAccountSettings />);
  await screen.findByText('Connectez votre compte pour utiliser Mistral.');
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter avec Mistral' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Connexion indisponible'));
  expect(popup.close).toHaveBeenCalledOnce();
  expect(screen.queryByText('Connecté')).toBeNull();
});
