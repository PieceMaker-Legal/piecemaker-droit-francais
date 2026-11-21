import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import '@/modules/i18n';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { ChatMessage } from '@/shared/types';

const timestamp = '2026-08-19T12:00:00.000Z';
const prompt: ChatMessage = {
  type: 'user',
  content: 'Read **this** [reference](https://example.com).',
  timestamp,
  transcriptAnchorId: 'prompt-1',
};

it('opens copy formats from the message without intercepting selection, links or editing', async () => {
  const onEditMessage = vi.fn();
  const writeText = vi.fn().mockResolvedValue(undefined);
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const selection = window.getSelection()!;
  try {
    render(
      <MessageComponent message={prompt} prevMessage={null} createDiff={() => []} provider="claude" onEditMessage={onEditMessage} />,
    );
    expect(screen.queryByText(new Date(timestamp).toLocaleTimeString())).toBeNull();
    expect(screen.queryByText('U')).toBeNull();
    expect(screen.queryByText('TXT')).toBeNull();
    expect(screen.queryByText('MD')).toBeNull();

    const edit = screen.getByRole('button', { name: /edit/i });
    fireEvent.click(edit);
    expect(onEditMessage).toHaveBeenCalledWith(prompt);
    const link = screen.getByRole('link', { name: 'reference' });
    expect(link.getAttribute('href')).toBe('https://example.com');
    fireEvent.click(link);
    expect(screen.queryByRole('group', { name: 'Copy message' })).toBeNull();

    const text = screen.getByText('this');
    const range = document.createRange();
    range.selectNodeContents(text);
    selection.addRange(range);
    fireEvent.click(text);
    expect(selection.toString()).toBe('this');
    expect(screen.queryByRole('group', { name: 'Copy message' })).toBeNull();
    selection.removeAllRanges();

    fireEvent.click(text, { button: 2 });
    expect(screen.queryByRole('group', { name: 'Copy message' })).toBeNull();
    fireEvent.click(text, { button: 0 });
    const formats = within(screen.getByRole('group', { name: 'Copy message' }));
    fireEvent.click(formats.getByText('TXT'));
    fireEvent.click(formats.getByText('MD'));
    expect(writeText.mock.calls).toEqual([['Read this reference.'], [prompt.content]]);
    await waitFor(() => expect(formats.getByText('Message copied')).toBeTruthy());
  } finally {
    selection.removeAllRanges();
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});

it('moves focus to the copy formats and restores it on Escape', () => {
  render(
    <UiPreferencesProvider>
      <MessageComponent
        message={{ type: 'assistant', content: 'Here is the answer.', timestamp }}
        prevMessage={null}
        createDiff={() => []}
        provider="claude"
      />
    </UiPreferencesProvider>,
  );
  const trigger = screen.getByRole('button', { name: 'Copy message' });
  trigger.focus();
  fireEvent.click(trigger, { detail: 0 });
  const textOption = screen.getByRole('button', { name: 'Copy as text' });
  expect(document.activeElement).toBe(textOption);
  fireEvent.keyDown(textOption, { key: 'Escape' });
  expect(screen.queryByRole('group', { name: 'Copy message' })).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
