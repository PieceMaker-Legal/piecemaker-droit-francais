import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { CloseWorkspacePanelContext } from '@/modules/piecemaker-workspace-tabs/context/WorkspacePanelsContext';
import { PanelPickButton } from '@/modules/piecemaker-workspace-tabs/PanelPickButton';

const command = vi.hoisted(() => ({ value: null as null | { selectedProject: { name: string }; handleNewSession: (project: { name: string }) => void } }));
vi.mock('@/modules/project-workspace/context/ProjectsStateContext', () => ({ useOptionalProjectCommandState: () => command.value }));

it('demande le ciblage au volet Catala et reflète son état', () => {
  const asked: unknown[] = [];
  const listen = (event: Event) => asked.push((event as CustomEvent).detail);
  window.addEventListener('piecemaker:panel-pick', listen);
  render(<><PanelPickButton tab="plugin:piecemaker-catala" /><PanelPickButton tab="plugin:example" /></>);
  const buttons = screen.getAllByRole('button', { name: 'Cibler un élément pour le chat' });
  expect(buttons).toHaveLength(1);
  fireEvent.click(buttons[0]);
  expect(asked).toEqual([{ tab: 'plugin:piecemaker-catala' }]);
  expect(buttons[0].getAttribute('aria-pressed')).toBe('false');
  act(() => { window.dispatchEvent(new CustomEvent('piecemaker:panel-pick-state', { detail: { tab: 'plugin:piecemaker-catala', active: true } })); });
  expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
  window.removeEventListener('piecemaker:panel-pick', listen);
});

it('ferme le volet après un ciblage sur petit écran seulement', () => {
  const closed: string[] = [];
  const picked = () => act(() => { window.dispatchEvent(new CustomEvent('piecemaker:panel-picked', { detail: { tab: 'plugin:piecemaker-catala' } })); });
  const { rerender } = render(<CloseWorkspacePanelContext.Provider value={(tab) => closed.push(tab)}><PanelPickButton tab="plugin:piecemaker-catala" /></CloseWorkspacePanelContext.Provider>);
  picked();
  expect(closed).toEqual([]);
  rerender(<CloseWorkspacePanelContext.Provider value={(tab) => closed.push(tab)}><PanelPickButton tab="plugin:piecemaker-catala" closeOnPick /></CloseWorkspacePanelContext.Provider>);
  picked();
  expect(closed).toEqual(['plugin:piecemaker-catala']);
});

it('ouvre un nouveau chat à la demande du volet Catala', () => {
  const opened: string[] = [];
  command.value = { selectedProject: { name: 'dossier-exemple' }, handleNewSession: (project) => opened.push(project.name) };
  render(<PanelPickButton tab="plugin:piecemaker-catala" />);
  act(() => { window.dispatchEvent(new CustomEvent('piecemaker:panel-new-chat', { detail: { tab: 'plugin:example' } })); });
  act(() => { window.dispatchEvent(new CustomEvent('piecemaker:panel-new-chat', { detail: { tab: 'plugin:piecemaker-catala' } })); });
  expect(opened).toEqual(['dossier-exemple']);
  command.value = null;
});
