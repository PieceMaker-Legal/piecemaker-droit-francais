import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { PanelPickButton } from '@/modules/piecemaker-workspace-tabs/PanelPickButton';

it('demande le ciblage au volet Catala et reflète son état', () => {
  const asked: unknown[] = [];
  const listen = (event: Event) => asked.push((event as CustomEvent).detail);
  window.addEventListener('piecemaker:panel-pick', listen);
  render(<><PanelPickButton tab="plugin:piecemaker-catala" /><PanelPickButton tab="plugin:example" /></>);
  const buttons = screen.getAllByRole('button', { name: 'Cibler une carte pour le chat' });
  expect(buttons).toHaveLength(1);
  fireEvent.click(buttons[0]);
  expect(asked).toEqual([{ tab: 'plugin:piecemaker-catala' }]);
  expect(buttons[0].getAttribute('aria-pressed')).toBe('false');
  act(() => { window.dispatchEvent(new CustomEvent('piecemaker:panel-pick-state', { detail: { tab: 'plugin:piecemaker-catala', active: true } })); });
  expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
  window.removeEventListener('piecemaker:panel-pick', listen);
});
