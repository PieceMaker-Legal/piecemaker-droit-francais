import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import ProviderLoginModal from '@/modules/provider-auth/ProviderLoginModal';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/modules/standalone-shell', () => ({ StandaloneShell: () => <div>Terminal CLI</div> }));
vi.mock('@/piecemaker/mistral-sdk/MistralAccountSettings', () => ({
  MistralAccountSettings: ({ onConnected }: { onConnected: () => void }) => <button onClick={onConnected}>Connexion SDK</button>,
}));

test('Mistral onboarding uses the SDK login and reports successful authorization without launching a terminal', () => {
  const complete = vi.fn();
  render(<ProviderLoginModal isOpen provider="mistral" onClose={vi.fn()} onComplete={complete} />);
  expect(screen.queryByText('Terminal CLI')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Connexion SDK' }));
  expect(complete).toHaveBeenCalledWith(0);
});
