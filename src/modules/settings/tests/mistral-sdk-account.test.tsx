import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import AccountContent from '@/modules/settings/tabs/agents-settings/sections/content/AccountContent';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/piecemaker/mistral-sdk/MistralAccountSettings', () => ({
  MistralAccountSettings: () => <div>Connexion SDK Mistral</div>,
}));

test('the Mistral account tab mounts the SDK settings even when legacy Vibe is unavailable', () => {
  render(<AccountContent agent="mistral" authStatus={{ authenticated: false, email: null, method: null, loading: false, error: 'Vibe absent' }} onLogin={vi.fn()} />);
  expect(screen.getByText('Connexion SDK Mistral')).toBeTruthy();
  expect(screen.queryByText('Vibe absent')).toBeNull();
});
