import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { SupportButton } from '@/piecemaker/support/SupportButton';

const pmSend = vi.fn();

vi.mock('@/piecemaker/dossier/api', () => ({ pmSend: (...args: unknown[]) => pmSend(...args) }));
const translate = (key: string) => key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));

beforeEach(() => {
  pmSend.mockReset();
  URL.createObjectURL = vi.fn(() => 'blob:rapport');
  URL.revokeObjectURL = vi.fn();
});

it('télécharge le rapport sans l’afficher, avec la description saisie', async () => {
  pmSend.mockResolvedValue({ filename: 'piecemaker-assistance.txt', content: 'Rapport\nJournal' });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  render(<SupportButton className="" iconClassName="" />);
  fireEvent.click(screen.getByRole('button', { name: 'assistance.title' }));
  fireEvent.change(screen.getByPlaceholderText('assistance.placeholder'), { target: { value: 'Mistral ne répond pas' } });
  fireEvent.click(screen.getByRole('button', { name: 'assistance.download' }));
  expect(await screen.findByText('assistance.downloaded')).toBeTruthy();
  expect(pmSend).toHaveBeenCalledWith('POST', '/support/report', { description: 'Mistral ne répond pas' });
  expect(click).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/Journal/)).toBeNull();
});

it('affiche l’erreur quand le rapport ne peut pas être préparé', async () => {
  pmSend.mockRejectedValue(new Error('Serveur injoignable'));
  render(<SupportButton className="" iconClassName="" />);
  fireEvent.click(screen.getByRole('button', { name: 'assistance.title' }));
  fireEvent.click(screen.getByRole('button', { name: 'assistance.download' }));
  expect(await screen.findByText('Serveur injoignable')).toBeTruthy();
});
