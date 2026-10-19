import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { SupportSettingsTab } from '@/piecemaker/support/SupportSettingsTab';

const pmSend = vi.fn();

vi.mock('@/piecemaker/dossier/api', () => ({ pmSend: (...args: unknown[]) => pmSend(...args) }));
const translate = (key: string) => key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));

beforeEach(() => {
  pmSend.mockReset();
});

it('envoie la description, affiche le rapport à relire et le laisse modifier', async () => {
  pmSend.mockResolvedValue({ filename: 'piecemaker-assistance.txt', content: 'Rapport\nJournal' });
  render(<SupportSettingsTab />);
  fireEvent.change(screen.getByPlaceholderText('assistance.placeholder'), { target: { value: 'Mistral ne répond pas' } });
  fireEvent.click(screen.getByRole('button', { name: 'assistance.prepare' }));
  const report = await screen.findByTestId('support-report') as HTMLTextAreaElement;
  expect(pmSend).toHaveBeenCalledWith('POST', '/support/report', { description: 'Mistral ne répond pas' });
  expect(report.value).toBe('Rapport\nJournal');
  fireEvent.change(report, { target: { value: 'Rapport' } });
  await waitFor(() => expect((screen.getByTestId('support-report') as HTMLTextAreaElement).value).toBe('Rapport'));
  expect(screen.getByRole('button', { name: 'assistance.download' })).toBeTruthy();
});

it('affiche l’erreur quand le rapport ne peut pas être préparé', async () => {
  pmSend.mockRejectedValue(new Error('Serveur injoignable'));
  render(<SupportSettingsTab />);
  fireEvent.click(screen.getByRole('button', { name: 'assistance.prepare' }));
  expect(await screen.findByText('Serveur injoignable')).toBeTruthy();
});
