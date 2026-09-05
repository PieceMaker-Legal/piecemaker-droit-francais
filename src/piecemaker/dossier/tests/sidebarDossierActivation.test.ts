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
