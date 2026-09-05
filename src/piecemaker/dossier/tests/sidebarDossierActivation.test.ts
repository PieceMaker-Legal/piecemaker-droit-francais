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

test('opens the Dossier tab after a sidebar project button is clicked', () => {
  const selectProject = vi.fn();
  const openDossier = vi.fn();
  const projectButton = document.createElement('button');
  const projectPath = document.createElement('span');
  const dossierTab = document.createElement('button');
  const dossierIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

  projectPath.title = '/Users/example/App';
  dossierTab.setAttribute('role', 'tab');
  dossierIcon.classList.add('lucide-scale');
  projectButton.append(projectPath);
  dossierTab.append(dossierIcon);
  projectButton.addEventListener('click', selectProject);
  dossierTab.addEventListener('click', openDossier);
  document.body.append(projectButton, dossierTab);

  fireEvent.click(projectPath);
  vi.runAllTimers();

  assert.equal(selectProject.mock.calls.length, 1);
  assert.equal(openDossier.mock.calls.length, 1);
});

test('waits for the workspace tabs to render after the first project selection', () => {
  const openDossier = vi.fn();
  const projectButton = document.createElement('button');
  const projectPath = document.createElement('span');

  projectPath.title = '/Users/example/App';
  projectButton.append(projectPath);
  document.body.append(projectButton);

  fireEvent.click(projectPath);

  const dossierTab = document.createElement('button');
  const dossierIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  dossierTab.setAttribute('role', 'tab');
  dossierIcon.classList.add('lucide-scale');
  dossierTab.append(dossierIcon);
  dossierTab.addEventListener('click', openDossier);
  document.body.append(dossierTab);
  vi.runAllTimers();

  assert.equal(openDossier.mock.calls.length, 1);
});

test('accepts Windows project paths', () => {
  const openDossier = vi.fn();
  const projectButton = document.createElement('button');
  const projectPath = document.createElement('span');
  const dossierTab = document.createElement('button');
  const dossierIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

  projectPath.title = 'C:\\cases\\App';
  dossierTab.setAttribute('role', 'tab');
  dossierIcon.classList.add('lucide-scale');
  projectButton.append(projectPath);
  dossierTab.append(dossierIcon);
  dossierTab.addEventListener('click', openDossier);
  document.body.append(projectButton, dossierTab);

  fireEvent.click(projectPath);
  vi.runAllTimers();

  assert.equal(openDossier.mock.calls.length, 1);
});

const mountSessionTabs = (compact = false) => {
  const session = document.createElement(compact ? 'div' : 'a');
  if (compact) session.className = 'active:scale-[0.98]';
  else session.setAttribute('href', '/session/example');
  session.addEventListener('click', (event) => event.preventDefault());
  const title = document.createElement('div');
  title.className = 'truncate text-sm font-normal';
  title.title = "d'où vient ce texte dans graphify ?";
  session.append(title);
  const openChat = vi.fn();
  const openDossier = vi.fn();
  document.body.append(session);
  for (const [iconClass, callback] of [
    ['lucide-message-square', openChat],
    ['lucide-scale', openDossier],
  ] as const) {
    const tab = document.createElement('button');
    tab.setAttribute('role', 'tab');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.classList.add(iconClass);
    tab.append(icon);
    tab.addEventListener('click', callback);
    document.body.append(tab);
  }
  return { session, title, openChat, openDossier };
};

for (const compact of [false, true]) {
  test(`opens Chat when selecting a ${compact ? 'compact' : 'desktop'} session, including the selected session`, () => {
    const { title, openChat, openDossier } = mountSessionTabs(compact);
    fireEvent.click(title);
    vi.runAllTimers();
    fireEvent.click(title);
    vi.runAllTimers();
    assert.equal(openChat.mock.calls.length, 2);
    assert.equal(openDossier.mock.calls.length, 0);
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
