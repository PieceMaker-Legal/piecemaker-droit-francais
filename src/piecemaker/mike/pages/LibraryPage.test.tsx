import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMikeData, downloadMikeDocument } = vi.hoisted(() => ({
  getMikeData: vi.fn(),
  downloadMikeDocument: vi.fn(),
}));
vi.mock('@/piecemaker/mike/api', () => ({ getMikeData, downloadMikeDocument }));

import { LibraryPage } from '@/piecemaker/mike/pages/LibraryPage';

const ROOT_RESPONSE = {
  documents: [
    { id: 'doc-1', filename: 'Assignation.pdf', file_type: 'pdf', size_bytes: 2_400_000, status: 'ready', created_at: '2026-01-05T00:00:00.000Z', folder_id: null },
  ],
  folders: [{ id: 'folder-1', name: 'Contrats', parent_folder_id: null }],
};

const FOLDER_RESPONSE = {
  documents: [
    { id: 'doc-2', filename: 'Bail commercial.docx', file_type: 'docx', size_bytes: 15_000, status: 'ready', created_at: '2026-01-06T00:00:00.000Z', folder_id: 'folder-1' },
  ],
  folders: [],
};

beforeEach(() => {
  getMikeData.mockReset().mockImplementation(async (endpoint: string) => {
    return endpoint.includes('parent_folder_id') ? FOLDER_RESPONSE : ROOT_RESPONSE;
  });
  downloadMikeDocument.mockReset();
});

describe('page Library', () => {
  it('affiche les dossiers et documents avec leurs métadonnées', async () => {
    render(<LibraryPage />);
    await screen.findByText('Assignation.pdf');
    expect(screen.getByText('Contrats')).toBeTruthy();
    expect(screen.getByText('PDF')).toBeTruthy();
    expect(screen.getByText('2,3 Mo')).toBeTruthy();
    expect(getMikeData).toHaveBeenCalledWith('/library/file');
  });

  it('affiche une erreur récupérable', async () => {
    getMikeData.mockReset().mockRejectedValueOnce(new Error('Bibliothèque Mike indisponible')).mockResolvedValueOnce(ROOT_RESPONSE);
    render(<LibraryPage />);
    expect((await screen.findByRole('alert')).textContent).toContain('Bibliothèque Mike indisponible');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await screen.findByText('Assignation.pdf');
  });

  it('change la requête en descendant dans un dossier', async () => {
    render(<LibraryPage />);
    await screen.findByText('Contrats');

    fireEvent.click(screen.getByText('Contrats'));
    await screen.findByText('Bail commercial.docx');
    await waitFor(() => expect(getMikeData).toHaveBeenCalledWith('/library/file?parent_folder_id=folder-1'));

    fireEvent.click(screen.getByRole('button', { name: 'Bibliothèque' }));
    await screen.findByText('Assignation.pdf');
  });
});
