import assert from 'node:assert/strict';

import { fireEvent } from '@testing-library/react';
import { test, vi } from 'vitest';

import '@/piecemaker/dossier/sidebarDossierActivation';

test('a sidebar project click keeps its handler and opens the Dossier tab', () => {
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

  assert.equal(selectProject.mock.calls.length, 1);
  assert.equal(openDossier.mock.calls.length, 1);

  projectButton.remove();
  dossierTab.remove();
});
