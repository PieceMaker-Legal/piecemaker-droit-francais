import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { PanelAnonymizationButton } from '@/modules/piecemaker-workspace-tabs/PanelAnonymizationButton';

const state = (detail: object) => act(() => { window.dispatchEvent(new CustomEvent('piecemaker:anonymization-state', { detail })); });

it('affiche le bouclier du volet Dossier et demande le mapping au clic', () => {
  render(<PanelAnonymizationButton tab="plugin:piecemaker-dossier" />);
  expect(screen.queryByRole('button')).toBeNull();
  state({ tab: 'plugin:piecemaker-dossier', project: '/dossier-exemple', anonymized: false, pending: false });
  expect(screen.getByRole('button', { name: 'Dossier non anonymisé — afficher le mapping' }).getAttribute('data-anonymized')).toBe('false');
  state({ tab: 'plugin:piecemaker-dossier', project: '/dossier-exemple', anonymized: true, pending: true });
  const button = screen.getByRole('button', { name: 'Dossier anonymisé — mapping à valider' });
  let asked = false;
  const listen = () => { asked = true; };
  window.addEventListener('piecemaker:mapping-show', listen);
  fireEvent.click(button);
  window.removeEventListener('piecemaker:mapping-show', listen);
  expect(asked).toBe(true);
  expect((window as Window & { __piecemakerMappingShow?: string }).__piecemakerMappingShow).toBe('/dossier-exemple');
});
