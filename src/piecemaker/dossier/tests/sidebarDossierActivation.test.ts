import assert from 'node:assert/strict';

import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/piecemaker/dossier/sidebarDossierActivation';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

test('leaves the active tab untouched when a sidebar project button is clicked', () => {
  const selectProject = vi.fn();
  const openTab = vi.fn();
  const projectButton = document.createElement('button');
  const projectPath = document.createElement('span');
  const tab = document.createElement('button');

  projectPath.title = '/Users/example/App';
  tab.setAttribute('role', 'tab');
  projectButton.append(projectPath);
  projectButton.addEventListener('click', selectProject);
  tab.addEventListener('click', openTab);
  document.body.append(projectButton, tab);

  fireEvent.click(projectPath);
  vi.runAllTimers();

  assert.equal(selectProject.mock.calls.length, 1);
  assert.equal(openTab.mock.calls.length, 0);
});

const mountSessionTabs = (compact = false) => {
  const session = document.createElement(compact ? 'div' : 'a');
  if (compact) session.className = 'active:scale-[0.98]';
  else session.setAttribute('href', '/session/example');
  session.addEventListener('click', (event) => event.preventDefault());
  const title = document.createElement('div');
  title.className = 'truncate text-sm font-normal';
  title.title = "d'où vient ce texte dans la chronologie ?";
  session.append(title);
  const openChat = vi.fn();
  document.body.append(session);
  const tab = document.createElement('button');
  tab.setAttribute('role', 'tab');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.classList.add('lucide-message-square');
  tab.append(icon);
  tab.addEventListener('click', openChat);
  document.body.append(tab);
  return { session, title, openChat };
};

for (const compact of [false, true]) {
  test(`opens Chat when selecting a ${compact ? 'compact' : 'desktop'} session, including the selected session`, () => {
    const { title, openChat } = mountSessionTabs(compact);
    fireEvent.click(title);
    vi.runAllTimers();
    fireEvent.click(title);
    vi.runAllTimers();
    assert.equal(openChat.mock.calls.length, 2);
  });
}

for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
  test(`preserves native session link behavior with ${modifier}`, () => {
    const { title, openChat } = mountSessionTabs();
    fireEvent.click(title, { [modifier]: true });
    vi.runAllTimers();
    assert.equal(openChat.mock.calls.length, 0);
  });
}

test('does not switch tabs for compact session action buttons', () => {
  const { session, openChat } = mountSessionTabs(true);
  const action = document.createElement('button');
  session.append(action);
  fireEvent.click(action);
  vi.runAllTimers();
  assert.equal(openChat.mock.calls.length, 0);
});
