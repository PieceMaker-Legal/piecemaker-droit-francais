import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { MikeSidebarNav } from '@/piecemaker/mike/MikeSidebarNav';
import { readMikePage, setMikePage } from '@/piecemaker/mike/page';

beforeEach(() => setMikePage(null));

describe('entrées Mike du pied de la barre latérale', () => {
  it('ouvre l’espace demandé et marque l’entrée courante', () => {
    render(<MikeSidebarNav />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Library', 'Tabular review', 'Workflows', 'Organisation',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Tabular review' }));
    expect(readMikePage()).toBe('/tabular-reviews');
    expect(screen.getByRole('button', { name: 'Tabular review' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Library' }).getAttribute('aria-current')).toBeNull();
  });

  it('suit la fermeture décidée ailleurs dans l’application', () => {
    render(<MikeSidebarNav />);
    fireEvent.click(screen.getByRole('button', { name: 'Workflows' }));
    act(() => setMikePage(null));
    expect(screen.getByRole('button', { name: 'Workflows' }).getAttribute('aria-current')).toBeNull();
  });
});
