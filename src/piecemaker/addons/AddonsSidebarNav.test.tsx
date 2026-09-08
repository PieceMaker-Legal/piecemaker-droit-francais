import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import '@/modules/i18n/config';
import { AddonsSidebarNav } from '@/piecemaker/addons/AddonsSidebarNav';
import { readAddonsPage, setAddonsPage } from '@/piecemaker/addons/page';

beforeEach(() => setAddonsPage(null));

describe('entrées Addons du pied de la barre latérale', () => {
  it('ouvre l’espace demandé et marque l’entrée courante', () => {
    render(<AddonsSidebarNav />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Library', 'Tabular review', 'Workflows', 'Organisation',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Tabular review' }));
    expect(readAddonsPage()).toBe('/tabular-reviews');
    expect(screen.getByRole('button', { name: 'Tabular review' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Library' }).getAttribute('aria-current')).toBeNull();
  });

  it('suit la fermeture décidée ailleurs dans l’application', () => {
    render(<AddonsSidebarNav />);
    fireEvent.click(screen.getByRole('button', { name: 'Workflows' }));
    act(() => setAddonsPage(null));
    expect(screen.getByRole('button', { name: 'Workflows' }).getAttribute('aria-current')).toBeNull();
  });
});
