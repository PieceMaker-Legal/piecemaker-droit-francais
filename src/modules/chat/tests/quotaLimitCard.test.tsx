import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);

const apiMock = vi.hoisted(() => ({
  scheduledMessages: { list: vi.fn(), create: vi.fn(), cancel: vi.fn() },
  user: { preferences: vi.fn(), savePreferences: vi.fn() },
  providers: { models: vi.fn() },
}));

vi.mock('@/shared/api', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), api: apiMock }));

import '@/modules/i18n';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { TranscriptSessionContext } from '@/modules/chat/context/TranscriptSessionContext';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { ChatMessage } from '@/shared/types';

const renderMessage = (message: ChatMessage, sessionId: string | null = 'session-1') =>
  render(
    <MemoryRouter>
      <UiPreferencesProvider>
        <TranscriptSessionContext.Provider value={{ sessionId }}>
          <MessageComponent message={message} prevMessage={null} createDiff={() => []} provider="claude" />
        </TranscriptSessionContext.Provider>
      </UiPreferencesProvider>
    </MemoryRouter>,
  );

const limitMessage: ChatMessage = {
  type: 'assistant',
  content: "You've hit your limit · resets 3pm (Europe/Paris)",
  timestamp: '2026-11-21T08:00:00.000Z',
};

describe('la carte de limite atteinte', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    apiMock.scheduledMessages.list.mockImplementation(() => json({ data: [] }));
    apiMock.scheduledMessages.create.mockImplementation(() => json({ data: {} }));
    apiMock.user.preferences.mockImplementation(() => json({ preferences: {} }));
    apiMock.user.savePreferences.mockImplementation(() => json({}));
    apiMock.providers.models.mockImplementation((provider: string) => json({ success: true, data: { models: { OPTIONS: [{ value: `${provider}-model`, label: `${provider} modèle` }], DEFAULT: `${provider}-model` } } }));
  });

  it('remplace le message brut du fournisseur', () => {
    const { container } = renderMessage(limitMessage);
    expect(container.querySelector('[data-quota-limit-card]')).not.toBeNull();
    expect(screen.getByText(/Limite d’utilisation de Claude atteinte/)).toBeTruthy();
  });

  it('programme la reprise dans la session quand la case est cochée', async () => {
    renderMessage(limitMessage);
    const checkbox = await screen.findByRole('checkbox');
    await waitFor(() => expect((checkbox as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(checkbox);
    await waitFor(() => expect(apiMock.scheduledMessages.create).toHaveBeenCalledTimes(1));
    const payload = apiMock.scheduledMessages.create.mock.calls[0][0];
    expect(payload.sessionId).toBe('session-1');
    expect(payload.content).toMatch(/^Reprends le travail/);
  });

  it('liste les modèles des autres fournisseurs pour reprendre ailleurs', async () => {
    renderMessage(limitMessage);
    fireEvent.click(await screen.findByRole('button', { name: /autre modèle/i }));
    expect(await screen.findByRole('button', { name: 'codex modèle' })).toBeTruthy();
  });

  it('laisse les réponses ordinaires telles quelles', () => {
    const { container } = renderMessage({ ...limitMessage, content: "L'article 429 du code civil s'applique." });
    expect(container.querySelector('[data-quota-limit-card]')).toBeNull();
  });
});
